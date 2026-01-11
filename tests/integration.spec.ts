
import { test, expect } from '@playwright/test';

test.describe('Light Lynx Integration', () => {
  test('should connect, create group, add lights, and create scene', async ({ page }) => {
    // Log console messages
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    // 1. Go to the app in admin mode
    await page.goto('/?admin=y');

    // 2. Click "Connect to a server" on landing page
    await page.click('text=Connect to a server');
    await expect(page).toHaveURL(/.*connect/);

    // 3. Fill connection details
    await page.fill('input[placeholder="your-server.com"]', '127.0.0.1');
    // Port for the mock server
    await page.fill('input[type="number"]', '25834');
    // Uncheck HTTPS
    const httpsCheckbox = page.locator('input[type="checkbox"]');
    if (await httpsCheckbox.isChecked()) {
        await httpsCheckbox.uncheck();
    }
    
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // 4. Wait for redirection to main page (Management section as we are in admin mode)
    await expect(page.locator('h1', { hasText: 'Management' })).toBeVisible({ timeout: 10000 });

    // 5. Create a group
    // Setup dialog handler before clicking
    const groupName = 'Test Group';
    page.once('dialog', dialog => dialog.accept(groupName));
    
    // Click "Create group" link
    await page.click('text=Create group');

    // Verify group appears in the list
    await expect(page.locator('h2', { hasText: groupName })).toBeVisible();

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
    await expect(page.locator('h1', { hasText: groupName })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Color Light' }).first()).toBeVisible();

    // Add another "White Light"
    await page.locator('h1', { hasText: 'Bulbs' }).locator('svg.icon').first().click();
    await page.click('h2:has-text("White Light")');
    await expect(page.locator('h2', { hasText: 'White Light' }).first()).toBeVisible();

    // 8. Create a scene
    const sceneName = 'Test Scene';
    page.once('dialog', dialog => {
        console.log('Dialog opened:', dialog.message());
        dialog.accept(sceneName);
    });
    
    // Click the "plus" icon in the Scenes header
    await page.locator('h1', { hasText: 'Scenes' }).locator('svg.icon').first().click();

    // Verify scene appears
    await expect(page.locator('h2', { hasText: sceneName }).first()).toBeVisible();
    
    console.log('Integration test completed successfully!');
  });
});
