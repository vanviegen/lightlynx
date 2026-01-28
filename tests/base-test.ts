import { test as base, expect, type Locator, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { createCipheriv } from 'crypto';
import { checkServerIdentity } from 'tls';

export { type Page, expect } from '@playwright/test';

// Extract line number from test file (not base-test.ts) from stack trace
function getTestFileLineNumber(): number {
    const stack = new Error().stack || '';
    const lines = stack.split('\n');
    // Find the first line that references a .spec.ts file
    for (const line of lines) {
        const match = line.match(/\/([^/]+\.spec\.[jt]s):(\d+):\d+/);
        if (match) {
            return parseInt(match[2], 10);
        }
    }
    return 0;
}

const OVERLAY_STYLE = `
    *, *::before, *::after { transition: none !important; animation: none !important; }
    .fadeOut, .fadeOut * { pointer-events: none !important; visibility: hidden !important; }
    #playwright-overlay.check {
        position: fixed;
        border: 2px solid #28a745;
        border-radius: 8px;
        border-bottom-left-radius: 0;
        background: rgba(40, 167, 69, 0.2);
        pointer-events: none;
        z-index: 1000000;
    }
    #playwright-overlay.check > p {
        position: absolute;
        top: 100%;
        left: -2px;;
        background: #28a745;
        color: black;
        padding: 2px 6px;
        border-radius: 3px;
        border-top-left-radius: 0;
        font-size: 12px; white-space: nowrap; font-family: sans-serif;
    }

    #playwright-overlay.banner {
        position: fixed;
        bottom: 0; left: 0;right: 0;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px 20px;
        font-family: sans-serif;
        font-size: 14px;
        z-index: 1000002;
        border-top: 2px solid #333;
        white-space: pre-wrap;
    }
    #playwright-overlay.banner.error { border-top-color: red !important; background: rgba(80, 0, 0, 0.9) !important; }
    #playwright-overlay.banner.info { border-top-color: #007acc !important; }
    #playwright-overlay.banner.success { border-top-color: #28a745 !important; }
`;

async function waitForRepaint(page: Page) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function hideOverlay(page: Page) {
    await page.evaluate(() => {
        const el = document.getElementById("playwright-overlay");
        if (el) el.remove();
    });
}

async function showOverlayCheck(page: Page, box: {x: number, y: number, width: number, height: number}, text?: string) {
    await page.evaluate(({ x, y, w, h, text }) => {
        const checkE = document.createElement('div');
        checkE.id = 'playwright-overlay';
        checkE.className = 'check';
        document.body.appendChild(checkE);
        Object.assign(checkE.style, {
            left: (x - 4) + 'px',
            top: (y - 4) + 'px',
            width: (w + 8) + 'px',
            height: (h + 8) + 'px',
        });
        if (text) {
            const textE = document.createElement('p');
            textE.innerText = text;
            checkE.appendChild(textE);
        }
    }, { x: box.x, y: box.y, w: box.width, h: box.height, text });
}

async function showOverlayBanner(page: Page, text: string, type: 'info' | 'error' | 'success' = 'info') {
    if (type === 'error') console.error(text);
    else if (type === 'info') console.log(text);
    await page.evaluate(({ text, type }) => {
        const bannerE = document.createElement('div');
        bannerE.id = 'playwright-overlay';
        bannerE.className = 'banner '+type;
        document.body.appendChild(bannerE);
        bannerE.textContent = text;
    }, { text, type });
}

export async function connectToMockServer(page: Page, admin: boolean = true): Promise<void> {
    // Use direct-connect URL
    await page.goto(`/?host=localhost:43598&username=admin${admin ? '&admin=y' : ''}`);
}

function wrapLocator(actualLocator: Locator, actualPage: Page): Locator {
    const wrapped = Object.create(actualLocator) as any;

    const actionMethods = ['click', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'dblclick', 'clear', '_expect'];
    for (const method of actionMethods) {
        wrapped[method] = async function(...args: any[]) {
            const short = method === '_expect' ? args[0] : (typeof args[0] === 'string' ? method + " " + JSON.stringify(args[0]) : method);
            const label = short + (short === method ? args : args.slice(1)).map(a => " "+JSON.stringify(a)).join("");
            try {
                // Some succes... we didn't crash! :-)
                const box = await actualLocator.boundingBox({timeout: 3000});
                if (!box) {
                    await showOverlayBanner(actualPage, `Cannot find ${actualLocator} for ${label}`, 'info');
                } else {
                    showOverlayCheck(actualPage, box, short);
                }
                await takeScreenshot(actualPage);
                return await (actualLocator as any)[method](...args);
            } catch(error: any) {
                await showOverlayBanner(actualPage, `Locator ${actualLocator} failed ${label}`, 'error');
                await takeScreenshot(actualPage);

                // Remove base-test.ts frames from the stack trace
                if (error.stack) {
                    const lines = error.stack.split('\n');
                    const filteredLines = lines.filter((line: string) => {
                        // Remove frames from this helper file
                        return !/base-test\.ts/.test(line);
                    });
                    error.stack = filteredLines.join('\n');
                }
                throw error;
            }
        };
    }
    
    const locatorReturning = ['locator', 'filter', 'nth', 'first', 'last', 'getByText', 'getByRole', 'getByPlaceholder', 'getByLabel', 'getByTestId', 'getByAltText', 'getByTitle'];
    for (const method of locatorReturning) {
        wrapped[method] = function(...args: any[]) {
            const subLocator = (actualLocator as any)[method](...args);
            return wrapLocator(subLocator, actualPage);
        };
    }
    
    return wrapped;
}

function wrapPage(actualPage: Page): Page {
    const wrapped = Object.create(actualPage) as any;
    
    // Intercept locator creation (all synchronous)
    const locatorReturning = ['locator', 'getByText', 'getByRole', 'getByPlaceholder', 'getByLabel', 'getByTestId', 'getByAltText', 'getByTitle'];
    for (const method of locatorReturning) {
        wrapped[method] = function(...args: any[]) {
            const loc = (actualPage as any)[method](...args);
            return wrapLocator(loc, actualPage);
        };
    }

    wrapped.goto = async function(url: string, options: any) {
        await actualPage.goto(url, options);
        await actualPage.waitForLoadState('load').catch(() => {});
        await actualPage.addStyleTag({ content: OVERLAY_STYLE });
        await showOverlayBanner(actualPage, "goto "+url, 'info');
        await takeScreenshot(actualPage);
    };
    
    return wrapped;
}

let lastScreenshotKey = '';
let lastScreenshotNumber = 0;

async function takeScreenshot(actualPage: Page) {
    const lineNumber = getTestFileLineNumber();
    const key = lastOutDir + ':' + lineNumber;
    if (lastScreenshotKey !== key) {
        lastScreenshotKey = key;
        lastScreenshotNumber = 0;
    } else {
        lastScreenshotNumber++;
    }

    await waitForRepaint(actualPage);

    const fileName = `${lineNumber.toString().padStart(4, '0')}` + String.fromCharCode(97 + lastScreenshotNumber);
    const pngPath = path.join(lastOutDir, `${fileName}.png`);
    const htmlPath = path.join(lastOutDir, `${fileName}.html`);
    
    // Output just the capture line number
    process.stdout.write(`Capture ${fileName}\n`);
    
    await actualPage.screenshot({ path: pngPath, fullPage: true });
    
    // Also capture DOM snapshot as HTML for structure analysis
    await hideOverlay(actualPage);
    const domHtml = await actualPage.evaluate(() => document.body.outerHTML);
    fs.writeFileSync(htmlPath, domHtml, 'utf-8');
}

let lastOutDir: string = '';

export const test = base.extend({
    page: async ({ page }, use, testInfo) => {
        const actualPage = page; // Keep reference to the actual page object
        
        // Create output directory name (initially in tests-out/)
        const baseName = path.basename(testInfo.file, '.spec.ts');
        const dirName = `${baseName}-${testInfo.line.toString().padStart(4, '0')}`;

        const outDir = path.join('tests-out', dirName);
        lastOutDir = outDir;

        // Ensure directory exists
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        
        // Override the output directory
        testInfo.outputPath = (name = '') => path.join(outDir, 'error.md');
        
        // const consoleLogs: string[] = [];
        actualPage.on('console', (...args: any[]) => console.log('Browser:', ...args));
        actualPage.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

        const wrappedPage = wrapPage(actualPage);
        await use(wrappedPage);
        
        // On test failure, move to failed directory and capture final state
        if (testInfo.status === 'failed' || testInfo.status === 'timedOut') {
            // Capture final screenshot
            await actualPage.screenshot({ path: path.join(outDir, 'error.png'), fullPage: false });
            
            // Capture final HTML
            const domHtml = await actualPage.evaluate(() => document.body.outerHTML);
            fs.writeFileSync(path.join(outDir, 'error.html'), domHtml, 'utf-8');
            
            // Create error.txt with useful diagnostic info
            let errorInfo = `Test: ${testInfo.title}\n`;
            errorInfo += `Status: ${testInfo.status}\n`;
            errorInfo += `Current URL: ${actualPage.url()}\n`;
            errorInfo += `Duration: ${testInfo.duration}ms\n\n`;
            
            if (testInfo.error) {
                errorInfo += `Error:\n${testInfo.error.stack || testInfo.error.message}\n\n`;
            }
            
            // Get browser console logs
            // if (consoleLogs.length > 0) {
            //     errorInfo += `Console Logs:\n${consoleLogs.join('\n')}\n\n`;
            // }
            
            fs.writeFileSync(path.join(outDir, "error.txt"), errorInfo, 'utf-8');
        }
    }
});
