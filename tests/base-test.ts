import { test as base, expect as playwrightExpect, type Locator, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const originalExpect = playwrightExpect;

let currentTakeScreenshot: ((lineNumber: number) => Promise<void>) | null = null;
let currentPage: Page | null = null;

// Extract line number from test file (not base-test.ts) from stack trace
function getTestFileLineNumber(): number {
    const stack = new Error().stack || '';
    const lines = stack.split('\n');
    // Find the first line that references a .spec.ts file
    for (const line of lines) {
        const match = line.match(/\/([^/]+\.spec\.ts):(\d+):\d+/);
        if (match) {
            return parseInt(match[2], 10);
        }
    }
    return 0;
}

const OVERLAY_STYLE = `
    *, *::before, *::after { transition: none !important; animation: none !important; }
    .fadeOut, .fadeOut * { pointer-events: none !important; visibility: hidden !important; }
    #playwright-overlay-cursor {
        position: fixed; width: 30px; height: 30px;
        background: rgba(255, 0, 0, 0.4); border: 2px solid red;
        border-radius: 50%; pointer-events: none; z-index: 1000000;
        display: none; transform: translate(-50%, -50%);
        box-shadow: 0 0 10px rgba(255,0,0,0.5);
    }
    #playwright-overlay-check {
        position: fixed; border: 3px solid #28a745; border-radius: 8px;
        background: rgba(40, 167, 69, 0.2); pointer-events: none;
        z-index: 1000000; display: none;
    }
    #playwright-overlay-banner {
        position: fixed; bottom: 0; left: 0; right: 0;
        background: rgba(0, 0, 0, 0.85); color: white; padding: 10px 20px;
        font-family: sans-serif; font-size: 14px; z-index: 1000002;
        display: none; border-top: 2px solid #333;
        white-space: pre-wrap;
    }
    .playwright-banner-error { border-top-color: red !important; background: rgba(80, 0, 0, 0.9) !important; }
    .playwright-banner-info { border-top-color: #007acc !important; }
    .playwright-banner-success { border-top-color: #28a745 !important; }
    #playwright-overlay-action {
        position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
        background: red; color: white; padding: 2px 6px; border-radius: 4px;
        font-size: 12px; white-space: nowrap; font-family: sans-serif;
    }
`;

async function waitForRepaint(page: Page) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function hideOverlays(page: Page) {
    await page.evaluate(() => {
        ['playwright-overlay-cursor', 'playwright-overlay-check', 'playwright-overlay-banner'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    });
}

async function showOverlayClick(page: Page, x: number, y: number, label: string) {
    await page.evaluate(({ x, y, label }) => {
        let cursor = document.getElementById('playwright-overlay-cursor');
        if (!cursor) {
            cursor = document.createElement('div');
            cursor.id = 'playwright-overlay-cursor';
            const actionLabel = document.createElement('div');
            actionLabel.id = 'playwright-overlay-action';
            cursor.appendChild(actionLabel);
            document.body.appendChild(cursor);
        }

        const actionLabel = document.getElementById('playwright-overlay-action')!;
        cursor.style.left = x + 'px';
        cursor.style.top = y + 'px';
        cursor.style.display = 'block';
        actionLabel.textContent = label;
        
        if ((window as any).__cursorTimeout) clearTimeout((window as any).__cursorTimeout);
        (window as any).__cursorTimeout = setTimeout(() => { cursor!.style.display = 'none'; }, 1000);
    }, { x, y, label });
}

async function showOverlayCheck(page: Page, x: number, y: number, w: number, h: number) {
    await page.evaluate(({ x, y, w, h }) => {
        let check = document.getElementById('playwright-overlay-check');
        if (!check) {
            check = document.createElement('div');
            check.id = 'playwright-overlay-check';
            document.body.appendChild(check);
        }
        check.style.left = (x - 4) + 'px';
        check.style.top = (y - 4) + 'px';
        check.style.width = (w + 8) + 'px';
        check.style.height = (h + 8) + 'px';
        check.style.display = 'block';
    }, { x, y, w, h });
}

async function showOverlayBanner(page: Page, text: string, type: 'info' | 'error' | 'success' = 'info') {
    await page.evaluate(({ text, type }) => {
        let banner = document.getElementById('playwright-overlay-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'playwright-overlay-banner';
            document.body.appendChild(banner);
        }
        banner.textContent = text;
        banner.className = 'playwright-banner-' + type;
        banner.style.display = 'block';
        if (type !== 'error') {
            if ((window as any).__bannerTimeout) clearTimeout((window as any).__bannerTimeout);
            (window as any).__bannerTimeout = setTimeout(() => { banner!.style.display = 'none'; }, 3000);
        }
    }, { text, type });
}
export const expect = ((actual: any, ...args: any[]) => {
    const isLocator = actual && typeof actual === 'object' && actual.__isProxy;
    const target = isLocator ? actual.__target : actual;
    const matchers = originalExpect(target, ...args);

    if (isLocator && currentPage && currentTakeScreenshot) {
        const page = currentPage;
        const takeScreenshot = currentTakeScreenshot;
        const locator = actual as Locator;
        return new Proxy(matchers, {
            get(targetMatchers, prop: string) {
                const origMatcher = (targetMatchers as any)[prop];
                if (typeof origMatcher === 'function') {
                    return async function(this: any, ...matcherArgs: any[]) {
                        const lineNumber = getTestFileLineNumber();
                        
                        // Hide previous overlays first
                        await hideOverlays(page);

                        // Run the matcher first - this waits for the element if needed (e.g., toBeVisible)
                        const result = await origMatcher.apply(targetMatchers, matcherArgs);
                        
                        // Matcher passed - now show success overlay
                        const box = await locator.boundingBox();
                        if (box) {
                            await showOverlayCheck(page, box.x, box.y, box.width, box.height);
                            await waitForRepaint(page);
                            await takeScreenshot(lineNumber);
                        }
                        
                        await hideOverlays(page);
                        return result;

                    };
                }
                return origMatcher;
            }
        });
    }
    return matchers;
}) as typeof playwrightExpect;

export type { Page };

export async function connectToMockServer(page: Page) {
    // Use shareable URL to connect directly
    await page.goto('/connect?host=localhost:43598&username=admin&admin=y');
    
    // Wait for connection to complete
    await expect(page.locator('h2', { hasText: 'Kitchen' })).toBeVisible({ timeout: 10000 });
}

function wrapLocator(locator: Locator, page: Page, takeScreenshot: (lineNumber: number) => Promise<void>): Locator {
    return new Proxy(locator, {
        get(target: any, prop: string, receiver: any) {
            if (prop === '__isProxy') return true;
            if (prop === '__target') return target;
            const orig = target[prop];
            if (typeof orig === 'function') {
                const actionMethods = ['click', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'dblclick', 'clear'];
                if (actionMethods.includes(prop)) {
                    return async function(this: any, ...args: any[]) {
                        const lineNumber = getTestFileLineNumber();
                        
                        // Clear previous overlay
                        await hideOverlays(page);
                        
                        // Overlay logic: find the element's position
                        const box = await target.boundingBox();
                        if (box) {
                            const centerX = box.x + box.width / 2;
                            const centerY = box.y + box.height / 2;
                            const label = (prop === 'fill' || prop === 'type' || prop === 'press') ? JSON.stringify(args[0]) : prop;
                            await showOverlayClick(page, centerX, centerY, label);
                            
                            // Wait for browser to repaint, then take screenshot
                            await waitForRepaint(page);
                            await takeScreenshot(lineNumber);
                        }

                        // Call the original method, but clean up stack traces on error
                        try {
                            return await orig.apply(target, args);
                        } catch (error: any) {
                            // Remove base-test.ts frames from the stack trace
                            if (error.stack) {
                                const lines = error.stack.split('\n');
                                const filteredLines = lines.filter(line => 
                                    !line.includes('/base-test.ts:') && !line.includes('Proxy.')
                                );
                                error.stack = filteredLines.join('\n');
                            }
                            throw error;
                        }
                    };
                }
                
                // Wrap methods that return new locators to maintain interception chain
                const locatorReturning = ['locator', 'filter', 'nth', 'first', 'last', 'getByText', 'getByRole', 'getByPlaceholder', 'getByLabel', 'getByTestId', 'getByAltText', 'getByTitle'];
                if (locatorReturning.includes(prop)) {
                    // Don't create a named wrapper - just return the wrapped locator directly
                    return (...args: any[]) => wrapLocator(orig.apply(target, args), page, takeScreenshot);
                }
                return orig.bind(target);
            }
            return Reflect.get(target, prop, receiver);
        }
    });
}

export const test = base.extend({
    page: async ({ page }, use, testInfo) => {
        const actualPage = page; // Keep reference to the actual page object
        
        // Extract test file line number from testInfo
        const testFilePath = testInfo.file;
        const testFileContent = fs.readFileSync(testFilePath, 'utf-8');
        const testLines = testFileContent.split('\n');
        
        // Find the line where this test starts (look for test( or test.only( followed by the test title)
        let testStartLine = 0;
        const testTitle = testInfo.title;
        for (let i = 0; i < testLines.length; i++) {
            const line = testLines[i];
            if ((line.includes('test(') || line.includes('test.only(')) && 
                (line.includes(`'${testTitle}'`) || line.includes(`"${testTitle}"`))) {
                testStartLine = i + 1; // Line numbers are 1-based
                break;
            }
        }
        
        // Create output directory name (initially in tests-passed/)
        const testFileName = path.basename(testFilePath, '.spec.ts');
        const dirName = `${testFileName}-${testStartLine.toString().padStart(4, '0')}`;
        const passedDir = path.join('tests-passed', dirName);
        const failedDir = path.join('tests-failed', dirName);
        
        // Start with passed directory
        let customOutputDir = passedDir;
        
        // Override the output directory
        testInfo.outputPath = (name = '') => path.join(customOutputDir, name);
        
        // Ensure directory exists
        if (!fs.existsSync(customOutputDir)) {
            fs.mkdirSync(customOutputDir, { recursive: true });
        }

        const takeScreenshot = async (lineNumber: number) => {
            const fileName = `${lineNumber.toString().padStart(4, '0')}`;
            const pngPath = path.join(customOutputDir, `${fileName}.png`);
            const htmlPath = path.join(customOutputDir, `${fileName}.html`);
            
            // Output just the capture line number
            process.stdout.write(`Capture ${fileName}\n`);
            
            await actualPage.screenshot({ path: pngPath, fullPage: false });
            
            // Also capture DOM snapshot as HTML for structure analysis
            await hideOverlays(actualPage);
            const domHtml = await actualPage.evaluate(() => document.body.outerHTML);
            fs.writeFileSync(htmlPath, domHtml, 'utf-8');
        };

        const consoleLogs: string[] = [];
        actualPage.on('console', msg => {
            consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
        });

        currentPage = actualPage;
        currentTakeScreenshot = takeScreenshot;

        // Proxy the Page object
        const pageProxy = new Proxy(actualPage, {
            get(target: Page, prop: string, receiver: any) {
                if (prop === '__isProxy') return true;
                if (prop === '__target') return target;
                const orig = (target as any)[prop];
                if (typeof orig === 'function') {
                    // Actions that should trigger a screenshot
                    const actionMethods = ['goto', 'click', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'reload', 'goBack', 'goForward'];
                    if (actionMethods.includes(prop)) {
                        return async function(this: any, ...args: any[]) {
                            const lineNumber = getTestFileLineNumber();
                            
                            // Clear previous overlay
                            await hideOverlays(actualPage);

                            // Find target element position for any action that takes a selector as first arg
                            const selector = args[0];
                            if (typeof selector === 'string' && prop !== 'goto') {
                                const handle = await actualPage.$(selector);
                                if (handle) {
                                    const box = await handle.boundingBox();
                                    if (box) {
                                        const label = (prop === 'fill' || prop === 'type' || prop === 'press') ? JSON.stringify(args[1]) : prop;
                                        await showOverlayClick(actualPage, box.x + box.width / 2, box.y + box.height / 2, label);
                                    }
                                }
                            }
                            
                            if (prop !== 'goto') {
                                    // Wait for browser to repaint, then take screenshot
                                    await waitForRepaint(actualPage);
                                    await takeScreenshot(lineNumber);
                            }

                            try {
                                const result = await orig.apply(target, args);
                                
                                if (prop === 'goto') {
                                    // For goto, we take screenshot after it loads
                                    await actualPage.waitForLoadState('load').catch(() => {});
                                    await actualPage.addStyleTag({ content: OVERLAY_STYLE });
                                    await actualPage.waitForTimeout(1000); // Wait longer for SPA to initialize
                                    const url = actualPage.url();
                                    await showOverlayBanner(actualPage, url, 'info');
                                    await actualPage.waitForTimeout(200);
                                    await takeScreenshot(lineNumber);
                                }
                                
                                return result;
                            } catch (error: any) {
                                // Remove base-test.ts frames from the stack trace
                                if (error.stack) {
                                    const lines = error.stack.split('\n');
                                    const filteredLines = lines.filter((line:string) => 
                                        !line.includes('/base-test.ts:') && !line.includes('Proxy.')
                                    );
                                    error.stack = filteredLines.join('\n');
                                }
                                throw error;
                            }
                        };
                    }
                    
                    // Intercept locator creation
                    const locatorReturning = ['locator', 'getByText', 'getByRole', 'getByPlaceholder', 'getByLabel', 'getByTestId', 'getByAltText', 'getByTitle'];
                    if (locatorReturning.includes(prop)) {
                        return function(this: any, ...args: any[]) {
                            const loc = orig.apply(target, args);
                            return wrapLocator(loc, actualPage, takeScreenshot);
                        };
                    }

                    return orig.bind(target);
                }
                return Reflect.get(target, prop, receiver);
            }
        });

        await use(pageProxy);
        
        // On test failure, move to failed directory and capture final state
        if (testInfo.status === 'failed' || testInfo.status === 'timedOut') {
            try {
                await hideOverlays(actualPage);
                
                // Capture final screenshot
                const errorScreenshotPath = path.join(customOutputDir, 'error.png');
                await actualPage.screenshot({ path: errorScreenshotPath, fullPage: false });
                
                // Capture final HTML
                const errorHtmlPath = path.join(customOutputDir, 'error.html');
                const domHtml = await actualPage.evaluate(() => document.body.outerHTML);
                fs.writeFileSync(errorHtmlPath, domHtml, 'utf-8');
                
                // Create error.txt with useful diagnostic info
                const errorTxtPath = path.join(customOutputDir, 'error.txt');
                let errorInfo = `Test: ${testInfo.title}\n`;
                errorInfo += `Status: ${testInfo.status}\n`;
                errorInfo += `Duration: ${testInfo.duration}ms\n\n`;
                
                if (testInfo.error) {
                    // Only show the stack trace (which includes the message at the top)
                    if (testInfo.error.stack) {
                        errorInfo += `Error:\n${testInfo.error.stack}\n\n`;
                    } else {
                        errorInfo += `Error: ${testInfo.error.message}\n\n`;
                    }
                }
                
                // Get browser console logs
                if (consoleLogs.length > 0) {
                    errorInfo += `Console Logs:\n${consoleLogs.join('\n')}\n\n`;
                }
                
                // Get page URL
                errorInfo += `Current URL: ${actualPage.url()}\n`;
                
                fs.writeFileSync(errorTxtPath, errorInfo, 'utf-8');
                
                // Move directory from tests-passed/ to tests-failed/
                if (fs.existsSync(passedDir)) {
                    // Ensure tests-failed directory exists
                    const failedParent = path.dirname(failedDir);
                    if (!fs.existsSync(failedParent)) {
                        fs.mkdirSync(failedParent, { recursive: true });
                    }
                    // Remove failedDir if it exists (from previous run)
                    if (fs.existsSync(failedDir)) {
                        fs.rmSync(failedDir, { recursive: true, force: true });
                    }
                    fs.renameSync(passedDir, failedDir);
                    customOutputDir = failedDir;
                }
                
                // Output the test results directory path
                process.stderr.write(`\n    Output for failed test moved to: ${failedDir}\n\n`);
            } catch (error) {
                console.warn(`Could not capture error state: ${error}`);
            }
        }
        
        currentPage = null;
        currentTakeScreenshot = null;
    }
});
