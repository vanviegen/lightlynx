import { test as base, expect as playwrightExpect, type Locator, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const originalExpect = playwrightExpect;

let currentTakeScreenshot: ((name: string) => Promise<void>) | null = null;
let currentPage: Page | null = null;

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
          return async (...matcherArgs: any[]) => {
            // Hide previous overlays first
            await page.evaluate(() => (window as any).__playwrightHide?.());

            try {
              // Run the matcher first - this waits for the element if needed (e.g., toBeVisible)
              const result = await origMatcher.apply(targetMatchers, matcherArgs);
              
              // Matcher passed - now show success overlay
              try {
                const box = await locator.boundingBox();
                if (box) {
                  await page.evaluate(({ x, y, w, h, label }) => {
                    (window as any).__playwrightShowCheck?.(x, y, w, h, label);
                  }, { x: box.x, y: box.y, w: box.width, h: box.height, label: prop });
                  await page.evaluate(() => (window as any).__playwrightWaitForRepaint?.());
                  await takeScreenshot(`check_${prop}`);
                }
              } catch {
                // Ignore overlay errors
              }
              
              await page.evaluate(() => (window as any).__playwrightHide?.());
              return result;
            } catch (err) {
              // Failed assertion - show error overlay
              await page.evaluate(({ msg, loc }) => {
                (window as any).__playwrightShowBanner?.(`${msg}\n${loc}`, 'error');
              }, { 
                msg: String(err).split('\n')[0],
                loc: String(locator)
              });
              await takeScreenshot(`fail_${prop}`);
              throw err;
            }
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
  // 1. Go to the app in admin mode
  await page.goto('/?admin=y');

  // 2. Check if already connected (look for Management header)
  const isConnected = await page.locator('h1', { hasText: 'Management' }).isVisible().catch(() => false);
  
  if (!isConnected) {
    // Go to connect page
    await page.click('text=Connect to a server');
    
    // 3. Fill connection details
    // Using localhost which connects to our mock lightlynx-api extension on port 43597
    await page.fill('input[placeholder="e.g. 192.168.1.5[:port]"]', 'localhost');
    
    // Fill credentials (known from mock-z2m setup)
    await page.fill('label:has-text("Username") + input', 'admin');
    await page.fill('label:has-text("Password") + input', 'admin');
    
    await page.click('button[type="submit"]');
    
    // Wait for redirection to main page
    await expect(page.locator('h1', { hasText: 'Management' })).toBeVisible({ timeout: 10000 });
  }
}

function wrapLocator(locator: Locator, page: Page, takeScreenshot: (name: string) => Promise<void>): Locator {
  return new Proxy(locator, {
    get(target: any, prop: string, receiver: any) {
      if (prop === '__isProxy') return true;
      if (prop === '__target') return target;
      const orig = target[prop];
      if (typeof orig === 'function') {
        const actionMethods = ['click', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'dblclick', 'clear'];
        if (actionMethods.includes(prop)) {
          return async (...args: any[]) => {
            try {
              // Clear previous overlay
              await page.evaluate(() => (window as any).__playwrightHide?.());
              
              // Overlay logic: find the element's position
              const box = await target.boundingBox();
              if (box) {
                const centerX = box.x + box.width / 2;
                const centerY = box.y + box.height / 2;
                const label = (prop === 'fill' || prop === 'type' || prop === 'press') ? JSON.stringify(args[0]) : prop;
                await page.evaluate(({ x, y, label }) => {
                  (window as any).__playwrightShowClick?.(x, y, label);
                }, { x: centerX, y: centerY, label });
                
                // Wait for browser to repaint, then take screenshot
                await page.evaluate(() => (window as any).__playwrightWaitForRepaint?.());
                await takeScreenshot(`before_${prop}`);
              }
            } catch (e) {
              // Ignore overlay errors
            }

            const result = await orig.apply(target, args);
            return result;
          };
        }
        
        // Wrap methods that return new locators to maintain interception chain
        const locatorReturning = ['locator', 'filter', 'nth', 'first', 'last', 'getByText', 'getByRole', 'getByPlaceholder', 'getByLabel', 'getByTestId', 'getByAltText', 'getByTitle'];
        if (locatorReturning.includes(prop)) {
          return (...args: any[]) => {
            const nextLocator = orig.apply(target, args);
            return wrapLocator(nextLocator, page, takeScreenshot);
          };
        }
        return orig.bind(target);
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    let stepCount = 0;

    const takeScreenshot = async (actionName: string) => {
      stepCount++;
      const fileName = `${stepCount.toString().padStart(3, '0')}-${actionName}.png`;
      const filePath = path.join(testInfo.outputDir, fileName);
      await page.screenshot({ path: filePath, fullPage: false });
      await testInfo.attach(`Step ${stepCount}: ${actionName}`, { path: filePath, contentType: 'image/png' });
    };

    currentPage = page;
    currentTakeScreenshot = takeScreenshot;

    // Inject overlay scripts into the browser
    await page.addInitScript(() => {
      // Wait for browser to actually repaint
      (window as any).__playwrightWaitForRepaint = () => {
        return new Promise<void>(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      };

      // Function to inject styles (may need to wait for document.head)
      const injectStyles = () => {
        if (document.getElementById('playwright-overlay-styles')) return;
        const style = document.createElement('style');
        style.id = 'playwright-overlay-styles';
        style.textContent = `
          *, *::before, *::after { transition: none !important; animation: none !important; }
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
        (document.head || document.documentElement).appendChild(style);
      };
      
      // Try to inject immediately, or wait for DOM
      if (document.head || document.documentElement) {
        injectStyles();
      } else {
        document.addEventListener('DOMContentLoaded', injectStyles);
      }

      (window as any).__playwrightHide = () => {
        ['playwright-overlay-cursor', 'playwright-overlay-check', 'playwright-overlay-banner'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
      };

      (window as any).__playwrightShowClick = (x: number, y: number, actionName: string) => {
        let cursor = document.getElementById('playwright-overlay-cursor');
        if (!cursor) {
          cursor = document.createElement('div');
          cursor.id = 'playwright-overlay-cursor';
          const label = document.createElement('div');
          label.id = 'playwright-overlay-action';
          cursor.appendChild(label);
          document.body.appendChild(cursor);
        }

        const actionLabel = document.getElementById('playwright-overlay-action');
        cursor.style.left = x + 'px';
        cursor.style.top = y + 'px';
        cursor.style.display = 'block';
        if (actionLabel) actionLabel.textContent = actionName;
        // Hide after 1 second
        if ((window as any).__cursorTimeout) clearTimeout((window as any).__cursorTimeout);
        (window as any).__cursorTimeout = setTimeout(() => { cursor!.style.display = 'none'; }, 1000);
      };

      (window as any).__playwrightShowCheck = (x: number, y: number, w: number, h: number, label: string) => {
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
      };

      (window as any).__playwrightShowBanner = (text: string, type: 'info' | 'error' | 'success' = 'info') => {
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
      };
    });

    // Proxy the Page object
    const pageProxy = new Proxy(page, {
      get(target: Page, prop: string, receiver: any) {
        if (prop === '__isProxy') return true;
        if (prop === '__target') return target;
        const orig = (target as any)[prop];
        if (typeof orig === 'function') {
          // Actions that should trigger a screenshot
          const actionMethods = ['goto', 'click', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'hover', 'reload', 'goBack', 'goForward'];
          if (actionMethods.includes(prop)) {
            return async (...args: any[]) => {
              // Clear previous overlay
              await page.evaluate(() => (window as any).__playwrightHide?.());

              // Find target element position for any action that takes a selector as first arg
              const selector = args[0];
              if (typeof selector === 'string' && prop !== 'goto') {
                try {
                  const handle = await page.$(selector);
                  if (handle) {
                    const box = await handle.boundingBox();
                    if (box) {
                      const label = (prop === 'fill' || prop === 'type' || prop === 'press') ? JSON.stringify(args[1]) : prop;
                      await page.evaluate(({x,y, label}) => (window as any).__playwrightShowClick?.(x,y, label), {x: box.x+box.width/2, y: box.y+box.height/2, label});
                    }
                  }
                } catch {
                  // Element might not be available yet or selector isn't a simple selector
                }
              }
              
              if (prop !== 'goto') {
                  // Wait for browser to repaint, then take screenshot
                  await page.evaluate(() => (window as any).__playwrightWaitForRepaint?.());
                  await takeScreenshot(`before_${prop}`);
              }

              const result = await orig.apply(target, args);
              
              if (prop === 'goto') {
                // For goto, we take screenshot after it loads
                await page.waitForLoadState('load').catch(() => {});
                await page.waitForTimeout(1000); // Wait longer for SPA to initialize
                const url = page.url();
                await page.evaluate((u) => {
                  if ((window as any).__playwrightShowBanner) {
                    (window as any).__playwrightShowBanner(u, 'info');
                  } else {
                    // Fallback create-and-show
                    let banner = document.getElementById('playwright-overlay-banner');
                    if (!banner) {
                      banner = document.createElement('div');
                      banner.id = 'playwright-overlay-banner';
                      banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,0.9);color:white;padding:10px;z-index:9999999;font-family:sans-serif;border-top:2px solid #007acc;';
                      document.body.appendChild(banner);
                    }
                    banner.textContent = u;
                    banner.style.display = 'block';
                  }
                }, url);
                await page.waitForTimeout(200);
                await takeScreenshot('after_goto');
              }
              
              return result;
            };
          }
          
          // Intercept locator creation
          const locatorReturning = ['locator', 'getByText', 'getByRole', 'getByPlaceholder', 'getByLabel', 'getByTestId', 'getByAltText', 'getByTitle'];
          if (locatorReturning.includes(prop)) {
            return (...args: any[]) => {
              const loc = orig.apply(target, args);
              return wrapLocator(loc, page, takeScreenshot);
            };
          }

          return orig.bind(target);
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    await use(pageProxy);
  }
});
