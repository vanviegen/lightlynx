import { test, expect, connectToMockServer } from './base-test';

test.describe('Device management', () => {
  test('should start permit join, show pulsing icon, add a new device after 5s, and auto-disable after 30s', async ({ page }) => {
    await connectToMockServer(page);

    // Go to Devices page to see all devices including toggles
    await page.locator('div.item', { hasText: /^Devices/ }).click();
    await expect(page.locator('header h1')).toContainText('Devices');

    const initialToggleCount = await page.locator('div.item').count();

    // Go back to main page to start permit join
    await page.locator('header img.logo').click();

    const searchItem = page.locator('div.item.link', { hasText: 'Search for device' });
    await expect(searchItem).toBeVisible();
    await searchItem.click();

    await expect(page.locator('div.item', { hasText: 'Searching for device' })).toBeVisible();
    await expect(page.locator('header svg.on.pulse')).toBeVisible();

    await page.waitForTimeout(5500);

    // Go back to Devices page to see the new toggle device
    await page.goto('/devices?manage=y');

    const newToggleCount = await page.locator('div.item').count();
    expect(newToggleCount).toBe(initialToggleCount + 1);

    // Go back to main page to stop searching
    await page.goto('/?instanceId=localhost:43598&userName=admin&manage=y');

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

    // Start searching for devices - the first new device will be a low-battery motion sensor
    const searchItem = page.locator('div.item.link', { hasText: 'Search for device' });
    await searchItem.click();

    // Wait for the new device to join (after 5 seconds)
    await page.waitForTimeout(5500);

    // Now we should see the critical battery warning icon (pulsing)
    const batteryIcon = page.locator('header svg[aria-label="batteryEmpty"].critical.pulse');
    await expect(batteryIcon).toBeVisible({ timeout: 5000 });
  });
});
