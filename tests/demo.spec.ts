import { test, expect, demoTap, demoType, demoPause, demoSwipe } from 'shotest';
import { connectToMockServer } from './base-test';

/**
* This can run as a normal test, and with playwright.video.config.ts, which causes a video
* to be recorded, and should cause video-helper to delay some operations and show taps
* on behalf of watchers living at human speeds.
*/

test('demo', async ({ page }) => {
    
    // ===== PART 1: Normal user exploration (no manage mode) =====
    
    // Connect to mock server without manage mode
    await connectToMockServer(page, { manage: false });
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    await demoPause(page, 3000); // Let viewer take in the main page
    
    // Toggle Living Room group on
    const livingRoomGroup = page.locator('.item.group').filter({
        has: page.locator('h2', { hasText: 'Living Room' })
    });
    const livingRoomCircle = livingRoomGroup.locator('.circle').first();
    await demoTap(page, livingRoomCircle);
    await demoPause(page, 1500);
    
    // Toggle it off
    await demoTap(page, livingRoomCircle);
    await demoPause(page, 1000);
    
    // Toggle Kitchen group on
    const kitchenGroup = page.locator('.item.group').filter({
        has: page.locator('h2', { hasText: 'Kitchen' })
    });
    const kitchenCircle = kitchenGroup.locator('.circle').first();
    await demoTap(page, kitchenCircle);
    await demoPause(page, 1000);
    
    // ===== Navigate into Living Room group =====
    const livingRoomLink = livingRoomGroup.locator('h2.link', { hasText: 'Living Room' });
    await demoTap(page, livingRoomLink);
    await expect(page.locator('header h1')).toContainText('Living Room');
    await demoPause(page, 3000); // Show color picker and scenes
    
    // Turn on the group so we can see color changes
    const groupCircle = page.locator('.circle').first();
    const circleClasses = await groupCircle.getAttribute('class');
    if (!circleClasses?.includes('on')) {
        await demoTap(page, groupCircle);
    }
    await demoPause(page, 500);
    
    // Scroll down so bulb list items are visible during color changes
    await page.evaluate(() => window.scrollBy({ top: 150, behavior: 'smooth' }));
    await demoPause(page, 800);
    
    // Swipe brightness slider
    const brightnessSlider = page.locator('canvas').first();
    await demoSwipe(page, brightnessSlider, 'right', 150);
    await demoPause(page, 2000);
    
    // Swipe color temperature
    const tempSlider = page.locator('canvas').nth(1);
    await demoSwipe(page, tempSlider, 'left', 120);
    await demoPause(page, 2000);
    
    // Swipe on hue slider
    const hueSlider = page.locator('canvas').nth(2);
    await demoSwipe(page, hueSlider, 'right', 80);
    await demoPause(page, 800);
    // Swipe on saturation slider
    const satSlider = page.locator('canvas').nth(3);
    await demoSwipe(page, satSlider, 'left', 80);
    await demoPause(page, 1500);
    
    // ===== Scenes =====
    // Scroll to scenes area
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await demoPause(page, 600);
    await page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' }));
    await demoPause(page, 1000);
    
    // Tap "Bright" scene
    const brightScene = page.locator('.item.link', { hasText: 'Bright' }).first();
    await demoTap(page, brightScene);
    await demoPause(page, 1500);
    
    // Tap "Cozy" scene
    const cozyScene = page.locator('.item.link', { hasText: 'Cozy' }).first();
    await demoTap(page, cozyScene);
    await demoPause(page, 1500);
    
    // ===== Individual Bulb =====
    const bulbLink = page.locator('h2.link', { hasText: 'Living Room Ceiling 1' }).first();
    await demoTap(page, bulbLink);
    await expect(page.locator('header h1')).toContainText('Living Room Ceiling 1');
    await demoPause(page, 2500);
    
    // Swipe on hue slider
    const bulbHueSlider = page.locator('canvas').nth(2);
    await demoSwipe(page, bulbHueSlider, 'left', 100);
    await demoPause(page, 1500);
    
    // Go back to group
    await page.goBack();
    await demoPause(page, 800);
    
    // Go back to top page
    await page.locator('header img.logo').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    await demoPause(page, 1500);
    
    // ===== PART 2: Enable manage mode =====
    
    // Tap the manage icon in the header (wrench icon)
    const manageIcon = page.locator('header svg[aria-label="admin"]');
    await demoTap(page, manageIcon);
    await demoPause(page, 2500); // Management and Users sections appear
    
    // Scroll down to show the Management section
    await page.evaluate(() => {
        const mgmt = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('Management'));
        if (mgmt) mgmt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await demoPause(page, 1500);
    
    // ===== Create a new group =====
    const createGroupButton = page.locator('div.item.link', { hasText: 'Create group' });
    await demoTap(page, createGroupButton);
    await demoPause(page, 500);
    
    const groupNameInput = page.getByRole('textbox').first();
    await demoType(page, groupNameInput, 'Demo Room', 100);
    await demoPause(page, 500);
    
    const okButton = page.getByRole('button', { name: 'OK' });
    await demoTap(page, okButton);
    await demoPause(page, 1500);
    
    // Add some lights to the new group
    const addLightIcon = page.getByRole('heading', { name: 'Bulbs' }).locator('svg').first();
    await demoTap(page, addLightIcon);
    await demoPause(page, 1500);
    
    // Add Office Ceiling light (unique - not in any group yet)
    const officeCeilingLight = page.locator('h2', { hasText: 'Office Ceiling' });
    await demoTap(page, officeCeilingLight);
    await demoPause(page, 1000);
    
    // Go back into add light mode to add another
    const addLightIcon2 = page.getByRole('heading', { name: 'Bulbs' }).locator('svg').first();
    await demoTap(page, addLightIcon2);
    await demoPause(page, 1500);
    
    // Add Office Desk Lamp
    const officeDeskLight = page.locator('h2', { hasText: 'Office Desk Lamp' });
    await demoTap(page, officeDeskLight);
    await demoPause(page, 1000);
    
    // After adding lights we should already be on the Demo Room page.
    await expect(page.locator('header h1')).toContainText('Demo Room');
    await demoPause(page, 1000);
    
    // Turn on the Demo Room group to show it works
    const demoRoomCircle = page.locator('.circle').first();
    await demoTap(page, demoRoomCircle);
    await demoPause(page, 1000);
    
    
    // ===== User Management =====
    await page.locator('header img.logo').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    await demoPause(page, 500);
    
    // Scroll to Users section
    await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('Users'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await demoPause(page, 1200);
    
    // Tap admin user
    const adminUserItem = page.locator('.list .item.link').filter({ hasText: 'admin' }).first();
    await demoTap(page, adminUserItem);
    await expect(page.locator('.subTitle')).toHaveText('user');
    await demoPause(page, 2000);
    
    // Go back
    await page.goBack();
    await demoPause(page, 800);
    
    // ===== Low Battery Demo =====
    // Scroll down to Management section
    await page.evaluate(() => {
        const mgmt = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('Management'));
        if (mgmt) mgmt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await demoPause(page, 1000);
    
    // Add a device - it should be in "low battery" state
    const devicesLink = page.locator('.list .item.link').filter({ hasText: /Search for devices$/ });
    await demoTap(page, devicesLink);
    // Wait for device to appear
    await demoPause(page, 5000);
    
    // The battery icon should now be visible in the header (pulsing red) - allow the user to see it
    await demoPause(page, 2500);
    
    // Click on battery icon to navigate to devices page
    const batteryIcon = page.locator('header svg[aria-label="batteryEmpty"].critical.pulse');
    await demoTap(page, batteryIcon, 7500);
    await expect(page.locator('header h1')).toContainText('Devices');
    await expect(page.locator('span.subTitle')).toContainText('buttons & sensors');
    await demoPause(page, 2500);
    
    // The low battery device should be at the top with red text
    const lowBatteryDevice = page.locator('div.item', { hasText: 'Motion sensor (Mock)' });
    await expect(lowBatteryDevice.locator('p.critical')).toContainText('3%');
    await demoPause(page, 2000);
});
