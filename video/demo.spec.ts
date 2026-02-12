import { test, expect, connectToMockServer, tap, slowType, pause, swipe } from './video-helpers';

test.describe('Light Lynx Demo Video', () => {
  test('full app demo (~2 minutes)', async ({ page }) => {

    // ===== PART 1: Normal user exploration (no manage mode) =====

    // Connect to mock server without manage mode
    await connectToMockServer(page, { manage: false });
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    await pause(page, 3000); // Let viewer take in the main page

    // Toggle Living Room group on
    const livingRoomGroup = page.locator('.item.group').filter({
      has: page.locator('h2', { hasText: 'Living Room' })
    });
    const livingRoomCircle = livingRoomGroup.locator('.circle').first();
    await tap(page, livingRoomCircle);
    await pause(page, 1500);

    // Toggle it off
    await tap(page, livingRoomCircle);
    await pause(page, 1000);

    // Toggle Kitchen group on
    const kitchenGroup = page.locator('.item.group').filter({
      has: page.locator('h2', { hasText: 'Kitchen' })
    });
    const kitchenCircle = kitchenGroup.locator('.circle').first();
    await tap(page, kitchenCircle);
    await pause(page, 1000);

    // ===== Navigate into Living Room group =====
    const livingRoomLink = livingRoomGroup.locator('h2.link', { hasText: 'Living Room' });
    await tap(page, livingRoomLink);
    await expect(page.locator('header h1')).toContainText('Living Room');
    await pause(page, 3000); // Show color picker and scenes

    // Turn on the group so we can see color changes
    const groupCircle = page.locator('.circle').first();
    const circleClasses = await groupCircle.getAttribute('class');
    if (!circleClasses?.includes('on')) {
      await tap(page, groupCircle);
    }
    await pause(page, 500);

    // Scroll down so bulb list items are visible during color changes
    await page.evaluate(() => window.scrollBy({ top: 150, behavior: 'smooth' }));
    await pause(page, 800);

    // Swipe brightness slider
    const brightnessSlider = page.locator('canvas').first();
    await swipe(page, brightnessSlider, 'right', 150);
    await pause(page, 2000);

    // Swipe color temperature
    const tempSlider = page.locator('canvas').nth(1);
    await swipe(page, tempSlider, 'left', 120);
    await pause(page, 2000);

    // Swipe on hue slider
    const hueSlider = page.locator('canvas').nth(2);
    await swipe(page, hueSlider, 'right', 80);
    await pause(page, 800);
    // Swipe on saturation slider
    const satSlider = page.locator('canvas').nth(3);
    await swipe(page, satSlider, 'left', 80);
    await pause(page, 1500);

    // ===== Scenes =====
    // Scroll to scenes area
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await pause(page, 600);
    await page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' }));
    await pause(page, 1000);

    // Tap "Bright" scene
    const brightScene = page.locator('.item.link', { hasText: 'Bright' }).first();
    await tap(page, brightScene);
    await pause(page, 1500);

    // Tap "Cozy" scene
    const cozyScene = page.locator('.item.link', { hasText: 'Cozy' }).first();
    await tap(page, cozyScene);
    await pause(page, 1500);

    // ===== Individual Bulb =====
    const bulbLink = page.locator('h2.link', { hasText: 'Living Room Ceiling 1' }).first();
    await tap(page, bulbLink);
    await expect(page.locator('header h1')).toContainText('Living Room Ceiling 1');
    await pause(page, 2500);

    // Swipe on hue slider
    const bulbHueSlider = page.locator('canvas').nth(2);
    await swipe(page, bulbHueSlider, 'left', 100);
    await pause(page, 1500);

    // Go back to group
    await page.goBack();
    await pause(page, 800);

    // Go back to top page
    await page.locator('header img.logo').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    await pause(page, 1500);

    // ===== PART 2: Enable manage mode =====

    // Tap the manage icon in the header (wrench icon)
    const manageIcon = page.locator('header svg[aria-label="admin"]');
    await tap(page, manageIcon);
    await pause(page, 2500); // Management and Users sections appear

    // Scroll down to show the Management section
    await page.evaluate(() => {
      const mgmt = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('Management'));
      if (mgmt) mgmt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await pause(page, 1500);

    // ===== Create a new group =====
    const createGroupButton = page.locator('div.item.link', { hasText: 'Create group' });
    await tap(page, createGroupButton);
    await pause(page, 500);

    const groupNameInput = page.getByRole('textbox').first();
    await slowType(page, groupNameInput, 'Bedroom', 100);
    await pause(page, 500);

    const okButton = page.getByRole('button', { name: 'OK' });
    await tap(page, okButton);
    await pause(page, 1500);

    // Scroll up to see the new group in the list
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await pause(page, 2000);

    // ===== Navigate into Living Room in manage mode to show scene config =====
    const livingRoomLink2 = page.locator('.item.group').filter({
      has: page.locator('h2', { hasText: 'Living Room' })
    }).locator('h2.link').first();
    await tap(page, livingRoomLink2);
    await expect(page.locator('header h1')).toContainText('Living Room');
    await pause(page, 2000);

    // Scroll to scenes and tap scene configure icon
    await page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' }));
    await pause(page, 1000);

    const sceneItem = page.locator('.item.link', { hasText: 'Cozy' }).first();
    const sceneConfigIcon = sceneItem.locator('svg').last();
    await tap(page, sceneConfigIcon);
    await pause(page, 2500); // Show scene editor

    // Go back from scene editor
    await page.goBack();
    await pause(page, 800);

    // Scroll to Bulbs section and show "Add light"
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('Bulbs'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await pause(page, 1000);

    const addLightIcon = page.getByRole('heading', { name: 'Bulbs' }).locator('svg').first();
    await tap(page, addLightIcon);
    await pause(page, 1500);

    // Go back
    await page.goBack();
    await pause(page, 500);

    // ===== User Management =====
    await page.locator('header img.logo').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    await pause(page, 500);

    // Scroll to Users section
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('Users'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await pause(page, 1200);

    // Tap admin user
    const adminUserItem = page.locator('.list .item.link').filter({ hasText: 'admin' }).first();
    await tap(page, adminUserItem);
    await expect(page.locator('.subTitle')).toHaveText('user');
    await pause(page, 2000);

    // Go back
    await page.goBack();
    await pause(page, 800);

    // ===== Low Battery Demo =====
    // Scroll down to Management section
    await page.evaluate(() => {
      const mgmt = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('Management'));
      if (mgmt) mgmt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await pause(page, 1000);

    // Tap on "Devices" link (not "Search for devices")
    const devicesLink = page.locator('.list .item.link').filter({ hasText: /^Devices$/ });
    await tap(page, devicesLink);
    await expect(page.locator('header h1')).toContainText('Devices');
    await pause(page, 2000);

    // Tap on "Living Room Button" (0x050)
    const buttonDevice = page.locator('div.item.link', { hasText: 'Living Room Button' });
    await tap(page, buttonDevice);
    await expect(page.locator('header h1')).toContainText('Living Room Button');
    await pause(page, 1500);

    // Scroll to Settings section
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('h1')).find(h => h.textContent?.includes('Settings'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await pause(page, 1000);

    // Change the name to trigger low battery
    const nameInput = page.locator('input').first();
    await tap(page, nameInput);
    await nameInput.clear();
    await slowType(page, nameInput, 'Low battery test', 100);
    await pause(page, 2000); // Wait for lazy save

    // Go back to top page
    await page.locator('header img.logo').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await pause(page, 2000);

    // The battery icon should now be visible in the header (pulsing red)
    const batteryIcon = page.locator('header svg[aria-label="batteryEmpty"].critical.pulse');
    await expect(batteryIcon).toBeVisible();
    await pause(page, 2500); // Let viewer see the pulsing icon

    // Click on battery icon to navigate to devices page
    await tap(page, batteryIcon);
    await expect(page.locator('header h1')).toContainText('Devices');
    await expect(page.locator('span.subTitle')).toContainText('buttons & sensors');
    await pause(page, 2500);

    // The low battery device should be at the top with red text
    const lowBatteryDevice = page.locator('div.item', { hasText: 'Low battery test' });
    await expect(lowBatteryDevice.locator('p.critical')).toContainText('4%');
    await pause(page, 2000);

    // ===== Closing =====
    await page.locator('header img.logo').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await pause(page, 3000);
  });
});
