
import { test, expect, connectToMockServer } from './base-test';

test.describe('Light Lynx Integration', () => {
  test('should connect, create group, add lights, and create scene', async ({ page }) => {
    // 1. Connect to the mock server using helper
    await connectToMockServer(page);

    // 5. Create a group
    const groupName = 'Test Group';
    
    // Click "Create group" link
    await page.click('text=Create group');

    // Fill in our custom prompt UI
    await page.getByRole('textbox').filter({ visible: true }).fill(groupName);
    await page.getByRole('button', { name: 'OK' }).filter({ visible: true }).click();

    // Verify group appears in the list
    await expect(page.locator('h2', { hasText: groupName }).filter({ visible: true })).toBeVisible();

    // 6. Navigate into the group
    await page.locator('h2', { hasText: groupName }).filter({ visible: true }).click();
    await expect(page.locator('span.subTitle', { hasText: 'group' }).filter({ visible: true })).toBeVisible();

    // 7. Add lights to the group
    // Select the icon in the Bulbs section of the active group page
    // Note: Use force: true because Playwright's hit testing sometimes gets confused by 
    // overlapping transition containers in this complex integration test.
    await page.locator('h1', { hasText: 'Bulbs' }).filter({ visible: true }).locator('svg.icon').click({ force: true });
    await expect(page.locator('span.subTitle', { hasText: 'add light' }).filter({ visible: true })).toBeVisible();

    // Add "Color Light"
    await page.locator('h2', { hasText: 'Color Light' }).filter({ visible: true }).click();
    // After adding, it should go back to group page
    await expect(page.locator('span.subTitle', { hasText: 'add light' }).filter({ visible: true })).not.toBeVisible();
    await expect(page.locator('span.subTitle', { hasText: 'group' }).filter({ visible: true })).toBeVisible();
    // Use filter({ visible: true }) to pick the matching visible one
    await expect(page.locator('h2', { hasText: 'Color Light' }).filter({ visible: true })).toBeVisible();

    // Add another "White Light"
    await page.locator('h1', { hasText: 'Bulbs' }).filter({ visible: true }).locator('svg.icon').click({ force: true });
    await page.locator('h2', { hasText: 'White Light' }).filter({ visible: true }).click();
    await expect(page.locator('span.subTitle', { hasText: 'add light' }).filter({ visible: true })).not.toBeVisible();
    await expect(page.locator('span.subTitle', { hasText: 'group' }).filter({ visible: true })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'White Light' }).filter({ visible: true })).toBeVisible();

    // 8. Create a scene
    const sceneName = 'Test Scene';
    
    // Click the "plus" icon in the Scenes header
    await page.locator('h1', { hasText: 'Scenes' }).filter({ visible: true }).locator('svg.icon').click({ force: true });

    // Fill in the scene name in our custom prompt UI
    await page.getByRole('textbox').filter({ visible: true }).fill(sceneName);
    await page.getByRole('button', { name: 'OK' }).filter({ visible: true }).click();

    // Verify scene appears
    await expect(page.locator('h2', { hasText: sceneName }).filter({ visible: true })).toBeVisible();
    
    console.log('Integration test completed successfully!');
  });
});
