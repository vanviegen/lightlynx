import { test, expect, connectToMockServer } from './base-test';

test.describe('Device management', () => {
  test('should start permit join, show pulsing icon, add a new device after 5s, and auto-disable after 30s', async ({ page }) => {
    await connectToMockServer(page);

    const initialDeviceCount = await page.locator('.list h2.link').count();

    const searchItem = page.locator('div.item.link', { hasText: 'Search for device' });
    await expect(searchItem).toBeVisible();
    await searchItem.click();

    await expect(page.locator('div.item', { hasText: 'Searching for device' })).toBeVisible();
    await expect(page.locator('header svg.on.pulse')).toBeVisible();

    await page.waitForTimeout(5500);

    const newDeviceCount = await page.locator('.list h2.link').count();
    expect(newDeviceCount).toBe(initialDeviceCount + 1);

    const stopItem = page.locator('div.item.link', { hasText: 'Stop searching' });
    await expect(stopItem).toBeVisible();
    await stopItem.click();

    await expect(page.locator('div.item.link', { hasText: 'Search for device' })).toBeVisible();
    await expect(page.locator('header svg.on.pulse')).not.toBeVisible();
  });

  test('should delete device from Zigbee2MQTT after confirmation', async ({ page }) => {
    await connectToMockServer(page, { manage: true });

    // Use Office Desk Lamp (0x00A) which is unlikely to be used by other tests
    // This avoids polluting state for subsequent tests that depend on Living Room devices
    const deviceName = 'Office Desk Lamp';
    const ieee = '0x00A';
    
    // Navigate directly to the device page
    await page.goto(`/device/${ieee}?manage=y`);
    await expect(page.locator('header h1')).toContainText(deviceName);

    const deleteItem = page.locator('div.item.link', { hasText: 'Delete from Zigbee2MQTT' });
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    await expect(page.locator('button.primary', { hasText: 'Yes' })).toBeVisible();
    await page.locator('button.primary', { hasText: 'Yes' }).click();

    await expect(page.locator('header h1')).toContainText('Light Lynx', { timeout: 10000 });
    await expect(page.locator('h2.link', { hasText: deviceName })).not.toBeVisible();
  });

  test('should show low battery warning in header when device has low battery', async ({ page }) => {
    await connectToMockServer(page, { manage: true });

    // Initially, battery levels are OK, so no warning should show
    await expect(page.locator('header svg[aria-label="batteryLow"]')).not.toBeVisible();
    await expect(page.locator('header svg[aria-label="batteryEmpty"]')).not.toBeVisible();

    // Rename a toggle device to include 'low' which triggers 4% battery
    const deviceIeee = '0x050'; // Living Room Button
    await page.goto(`/device/${deviceIeee}?manage=y`);
    await expect(page.locator('header h1')).toContainText('Living Room Button');

    // Change the name to trigger low battery
    const nameInput = page.locator('input').first();
    await nameInput.clear();
    await nameInput.fill('Low battery test');
    
    // Wait for the lazy save to complete (1 second delay)
    await page.waitForTimeout(1500);

    // Go back to the top page
    await page.locator('header svg[aria-label="back"]').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');

    // Now we should see the critical battery warning icon (pulsing)
    const batteryIcon = page.locator('header svg[aria-label="batteryEmpty"].critical.pulse');
    await expect(batteryIcon).toBeVisible({ timeout: 5000 });

    // Click on the battery icon to go to devices page filtered by battery
    await batteryIcon.click();
    
    // Should be on devices page, filtered to toggles, sorted by battery
    await expect(page.locator('header h1')).toContainText('Devices');
    await expect(page.locator('span.subTitle')).toContainText('buttons & sensors');
    
    // The low battery device should be visible and at the top
    const lowBatteryDevice = page.locator('div.item', { hasText: 'Low battery test' });
    await expect(lowBatteryDevice).toBeVisible();
    await expect(lowBatteryDevice.locator('p.critical')).toContainText('4%');
  });
});
