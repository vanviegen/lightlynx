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
    await connectToMockServer(page);

    const deviceName = 'Living Room Ceiling 1';
    await page.locator('.list h2.link', { hasText: 'Living Room' }).click();
    await expect(page.locator('header h1')).toContainText('Living Room');
    await page.locator('.list h2.link', { hasText: deviceName }).click();
    await expect(page.locator('header h1')).toContainText(deviceName);

    const deleteItem = page.locator('div.item.link', { hasText: 'Delete from Zigbee2MQTT' });
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    await expect(page.locator('button.primary', { hasText: 'Yes' })).toBeVisible();
    await page.locator('button.primary', { hasText: 'Yes' }).click();

    await expect(page.locator('header h1')).toContainText('Light Lynx', { timeout: 10000 });
    await expect(page.locator('h2.link', { hasText: deviceName })).not.toBeVisible();
  });
});
