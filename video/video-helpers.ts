import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

export { type Page, expect } from '@playwright/test';

// Detect if we're running in video recording mode
function isVideoMode(testInfo: TestInfo): boolean {
    return testInfo.project.use.video !== undefined && testInfo.project.use.video !== 'off';
}

// Custom test fixture that adapts to video or test mode
export const test = base.extend<{ videoPage: Page }>({
    page: async ({ page }, use, testInfo) => {
        const videoMode = isVideoMode(testInfo);

        // Use addInitScript so this runs on every navigation (including page.goBack)
        await page.addInitScript((isVideo: boolean) => {
            (window as any).__VIDEO_MODE__ = isVideo;

            if (isVideo) {
                // Override webdriver detection so app keeps transitions enabled
                Object.defineProperty(navigator, 'webdriver', { get: () => false });

                // Inject touch ripple CSS
                const style = document.createElement('style');
                style.textContent = `
                    .video-touch-ripple {
                        position: fixed;
                        border: 4px solid rgba(255, 255, 255, 0.95);
                        border-radius: 50%;
                        pointer-events: none;
                        z-index: 10000000;
                        background: rgba(255, 255, 255, 0.15);
                        box-shadow: 0 0 20px rgba(255, 255, 255, 0.5);
                        animation: ripple-expand 600ms ease-out forwards;
                    }
                    @keyframes ripple-expand {
                        0% {
                            width: 20px;
                            height: 20px;
                            opacity: 1;
                            margin-left: -10px;
                            margin-top: -10px;
                        }
                        100% {
                            width: 140px;
                            height: 140px;
                            opacity: 0;
                            margin-left: -70px;
                            margin-top: -70px;
                        }
                    }
                    .video-swipe-indicator {
                        position: fixed;
                        width: 44px;
                        height: 44px;
                        margin-left: -22px;
                        margin-top: -22px;
                        border: 3px solid rgba(255, 255, 255, 0.85);
                        border-radius: 50%;
                        pointer-events: none;
                        z-index: 10000000;
                        background: rgba(255, 255, 255, 0.12);
                        box-shadow: 0 0 16px rgba(255, 255, 255, 0.4);
                        transition: opacity 350ms ease-out, transform 350ms ease-out;
                    }
                    .video-swipe-indicator.fade-out {
                        opacity: 0;
                        transform: scale(2.2);
                    }
                `;
                // Inject as soon as <head> is available
                if (document.head) document.head.appendChild(style);
                else document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
            } else {
                // Test mode: disable transitions and animations for speed
                const style = document.createElement('style');
                style.textContent = `
                    *, *::before, *::after { transition: none !important; animation: none !important; }
                    .fadeOut, .fadeOut * { pointer-events: none !important; visibility: hidden !important; }
                `;
                if (document.head) document.head.appendChild(style);
                else document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
            }
        }, videoMode);

        await use(page);

        // Video mode: copy video to build.demo/demo.webm and clean up Playwright's directory
        if (videoMode) {
            const videoPath = await page.video()?.path();
            if (videoPath) {
                // Wait for video to be fully written
                await page.close();
                
                // Give it a moment to finalize
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                if (fs.existsSync(videoPath)) {
                    const outputDir = path.join(process.cwd(), 'build.demo');
                    if (!fs.existsSync(outputDir)) {
                        fs.mkdirSync(outputDir, { recursive: true });
                    }
                    const destPath = path.join(outputDir, 'demo.webm');
                    fs.copyFileSync(videoPath, destPath);
                    console.log(`\n✅ Video saved to: ${destPath}\n`);
                    
                    // Clean up the Playwright output directory to avoid duplication
                    const playwrightDir = path.dirname(videoPath);
                    try {
                        fs.rmSync(playwrightDir, { recursive: true, force: true });
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                }
            }
        }
    },
});

export async function connectToMockServer(page: Page, options: { manage?: boolean; userName?: string; password?: string } = {}): Promise<void> {
    const { manage = true, userName = 'admin', password = '' } = options;
    // Use direct-connect URL
    const manageParam = manage ? '&manage=y' : '';
    const passwordParam = password ? `&secret=${encodeURIComponent(password)}` : '';
    await page.goto(`/?instanceId=localhost:43598&userName=${encodeURIComponent(userName)}${passwordParam}${manageParam}`);
}

/**
 * Tap an element with optional visual touch ripple effect (video mode only)
 */
export async function tap(page: Page, locator: Locator, delayMs: number = 800): Promise<void> {
    // Check if we're in video mode via the window flag
    const hasVideo = await page.evaluate(() => (window as any).__VIDEO_MODE__ === true);

    if (hasVideo) {
        // Video mode: show ripple and delay
        const box = await locator.boundingBox();
        if (!box) {
            throw new Error('Element not visible or has no bounding box');
        }

        // Calculate center position
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;

        // Inject touch ripple at the tap position
        await page.evaluate(({ x, y }) => {
            const ripple = document.createElement('div');
            ripple.className = 'video-touch-ripple';
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            document.body.appendChild(ripple);

            // Remove ripple after animation completes
            setTimeout(() => ripple.remove(), 650);
        }, { x: centerX, y: centerY });

        // Wait for ripple to be visible before clicking
        await page.waitForTimeout(200);

        // Perform the actual click
        await locator.click();

        // Wait for the specified delay
        await page.waitForTimeout(delayMs - 100);
    } else {
        // Test mode: immediate click, no delays
        await locator.click();
    }
}

/**
 * Type text slowly character by character (video mode) or instantly (test mode)
 */
export async function slowType(page: Page, locator: Locator, text: string, charDelayMs: number = 80): Promise<void> {
    const hasVideo = await page.evaluate(() => (window as any).__VIDEO_MODE__ === true);

    if (hasVideo) {
        // Video mode: type character by character with delay
        await locator.click();
        await page.waitForTimeout(200);
        
        for (const char of text) {
            await page.keyboard.type(char);
            await page.waitForTimeout(charDelayMs);
        }
    } else {
        // Test mode: type instantly
        await locator.fill(text);
    }
}

/**
 * Pause for viewing time (video mode only, skipped in test mode)
 */
export async function pause(page: Page, ms: number = 2000): Promise<void> {
    const hasVideo = await page.evaluate(() => (window as any).__VIDEO_MODE__ === true);

    if (hasVideo) {
        // Video mode: pause for viewing
        await page.waitForTimeout(ms);
    }
    // Test mode: no pause
}

/**
 * Swipe gesture in a specific direction
 */
export async function swipe(
    page: Page,
    locator: Locator,
    direction: 'up' | 'down' | 'left' | 'right',
    distancePx: number = 200
): Promise<void> {
    const hasVideo = await page.evaluate(() => (window as any).__VIDEO_MODE__ === true);

    // Get bounding box of the locator
    const box = await locator.boundingBox();
    if (!box) {
        throw new Error('Element not visible or has no bounding box');
    }

    // Calculate start position (center of element)
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Calculate end position based on direction
    let endX = startX;
    let endY = startY;

    switch (direction) {
        case 'up':
            endY = startY - distancePx;
            break;
        case 'down':
            endY = startY + distancePx;
            break;
        case 'left':
            endX = startX - distancePx;
            break;
        case 'right':
            endX = startX + distancePx;
            break;
    }

    if (hasVideo) {
        // Video mode: show a sliding touch indicator, move gradually with easing

        // Create the indicator at the start position
        await page.evaluate(({ x, y }) => {
            const dot = document.createElement('div');
            dot.className = 'video-swipe-indicator';
            dot.id = '__swipe_indicator__';
            dot.style.left = `${x}px`;
            dot.style.top = `${y}px`;
            document.body.appendChild(dot);
        }, { x: startX, y: startY });

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.waitForTimeout(120);

        // More steps + easeOutCubic for a gradual, decelerating slide
        const steps = 40;
        for (let i = 1; i <= steps; i++) {
            // easeOutCubic: fast start, gradual slow-down
            const t = i / steps;
            const ease = 1 - Math.pow(1 - t, 3);
            const cx = startX + (endX - startX) * ease;
            const cy = startY + (endY - startY) * ease;

            await page.mouse.move(cx, cy);

            // Move the indicator to follow the "finger"
            await page.evaluate(({ x, y }) => {
                const dot = document.getElementById('__swipe_indicator__');
                if (dot) {
                    dot.style.left = `${x}px`;
                    dot.style.top = `${y}px`;
                }
            }, { x: cx, y: cy });

            await page.waitForTimeout(18);
        }

        await page.waitForTimeout(60);
        await page.mouse.up();

        // Fade out the indicator with expanding ring effect
        await page.evaluate(() => {
            const dot = document.getElementById('__swipe_indicator__');
            if (dot) {
                dot.classList.add('fade-out');
                setTimeout(() => dot.remove(), 400);
            }
        });
        await page.waitForTimeout(450);
    } else {
        // Test mode: fast swipe, no indicator
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.waitForTimeout(50);

        const steps = 20;
        const stepX = (endX - startX) / steps;
        const stepY = (endY - startY) / steps;

        for (let i = 1; i <= steps; i++) {
            await page.mouse.move(startX + stepX * i, startY + stepY * i);
            await page.waitForTimeout(10);
        }

        await page.waitForTimeout(50);
        await page.mouse.up();
        await page.waitForTimeout(200);
    }
}
