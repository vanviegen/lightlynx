
import { test, expect, Page, connectToMockServer } from './base-test';

test.describe('Extension Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Log console messages for debugging
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.text().includes('api')) {
            console.log('BROWSER:', msg.text());
        }
    });
  });

  test('should verify extensions are installed and working', async ({ page }) => {
    await connectToMockServer(page);
    
    // Ensure we are in admin mode
    await page.goto('/?admin=y');

    // --- TEST API EXTENSION ---

    // 1. Verify API is installed (Users section shows admin user)
    await expect(page.locator('h2', { hasText: 'admin' })).toBeVisible({ timeout: 15000 });
    
    // --- TEST AUTOMATION EXTENSION ---

    // 2. Go to a group page and verify Automation is present
    const groupName = 'Living Room'; // From mock-z2m.ts
    await page.locator('h2', { hasText: groupName }).click();
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();
    await expect(page.locator('h1', { hasText: 'Buttons and sensors' })).toBeVisible();

    // 3. Uninstall Automation
    // Automatically accept all dialogs
    page.on('dialog', dialog => dialog.accept());
    
    await page.goto('/?admin=y');
    
    // Find the automation item and its remove button
    const automationItem = page.locator('div.item', { has: page.locator('h2', { hasText: 'automation' }) });
    const removeAutomationBtn = automationItem.locator('svg.icon').last();
    await removeAutomationBtn.click();

    // 4. Verify Automation is gone (go to group page)
    await page.locator('h2', { hasText: groupName }).click();
    await expect(page.locator('text=Connecting buttons and sensors to a group requires our automation Z2M extension.')).toBeVisible();

    // 5. Re-install Automation
    await page.goto('/?admin=y');
    const automationItemAgain = page.locator('div.item', { has: page.locator('h2', { hasText: 'automation' }) });
    const installAutomationBtn = automationItemAgain.locator('svg.icon').last();
    await installAutomationBtn.click();

    // 6. Verify Automation is back
    await page.locator('h2', { hasText: groupName }).click();
    await expect(page.locator('h1', { hasText: 'Buttons and sensors' })).toBeVisible({ timeout: 10000 });
  });
});
