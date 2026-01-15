
import { test, expect, connectToMockServer } from './base-test';

test.describe('Light Lynx Integration', () => {
  test('should connect, create group, add lights, and create scene', async ({ page }) => {
    // Log console messages
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    // 1. Connect to the mock server using helper
    await connectToMockServer(page);

    // 5. Create a group
    const groupName = 'Test Group';
    
    // Click "Create group" link
    await page.click('text=Create group');

    // Fill in our custom prompt UI
    await page.fill('input[type="text"]', groupName);
    await page.click('button.primary:has-text("OK")');

    // Verify group appears in the list
    await expect(page.locator('h2', { hasText: groupName }).first()).toBeVisible();

    // 6. Navigate into the group
    await page.click(`h2:has-text("${groupName}")`);
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();

    // 7. Add lights to the group
    // Click the "plus" icon in the Bulbs header
    await page.locator('h1', { hasText: 'Bulbs' }).locator('svg.icon').first().click();
    await expect(page.locator('span.subTitle', { hasText: 'add light' })).toBeVisible();

    // Add "Color Light"
    await page.click('h2:has-text("Color Light")');
    // After adding, it should go back to group page
    await expect(page.locator('span.subTitle', { hasText: 'add light' })).not.toBeVisible();
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();
    // Use first() to pick the first matching visible one
    await expect(page.locator('h2', { hasText: 'Color Light' }).first()).toBeVisible();

    // Add another "White Light"
    await page.locator('h1', { hasText: 'Bulbs' }).locator('svg.icon').first().click();
    await page.click('h2:has-text("White Light")');
    await expect(page.locator('span.subTitle', { hasText: 'add light' })).not.toBeVisible();
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'White Light' }).first()).toBeVisible();

    // 8. Create a scene
    const sceneName = 'Test Scene';
    
    // Click the "plus" icon in the Scenes header
    await page.locator('h1', { hasText: 'Scenes' }).locator('svg.icon').first().click();

    // Fill in the scene name in our custom prompt UI
    await page.fill('input[type="text"]', sceneName);
    await page.click('button.primary:has-text("OK")');

    // Verify scene appears
    await expect(page.locator('h2', { hasText: sceneName }).first()).toBeVisible();
    
    console.log('Integration test completed successfully!');
  });
});
