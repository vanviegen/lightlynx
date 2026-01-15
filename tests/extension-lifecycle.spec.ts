
import { test, expect, connectToMockServer } from './base-test';

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

    // 2. Go to a group page and verify Automation is NOT present (shows prompt)
    const groupName = 'Living Room'; // From mock-z2m.ts
    await page.locator('.grid h2.link', { hasText: groupName }).first().click();
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();
    await expect(page.locator('text=Connecting buttons and sensors to a group requires our automation Z2M extension.')).toBeVisible();

    // 3. Install Automation extension
    await page.goto('/?admin=y');
    const automationItem = page.locator('div.item', { has: page.locator('h2', { hasText: 'automation' }) });
    const installAutomationBtn = automationItem.locator('svg.icon').last();
    await installAutomationBtn.click();

    // Wait for restart and reconnection (Mock Z2M restarts on extension save)
    await expect(page.locator('h2', { hasText: 'admin' })).toBeVisible({ timeout: 20000 });

    // 4. Verify Automation is now present
    await page.locator('.grid h2.link', { hasText: groupName }).first().click();
    await expect(page.locator('h1', { hasText: 'Buttons and sensors' })).toBeVisible();
    // In admin mode with extension, it should show "None yet" if no inputs linked
    await expect(page.locator('text=None yet')).toBeVisible();

    // 5. Uninstall Automation
    await page.goto('/?admin=y');
    const automationItemAgain = page.locator('div.item', { has: page.locator('h2', { hasText: 'automation' }) });
    const removeAutomationBtn = automationItemAgain.locator('svg.icon').last();
    await removeAutomationBtn.click();

    // Handle custom confirmation dialog
    await page.waitForSelector('button.primary:has-text("Yes")');
    await page.click('button.primary:has-text("Yes")');

    // 6. Verify Automation is gone
    await page.locator('.grid h2.link', { hasText: groupName }).first().click();
    await expect(page.locator('text=Connecting buttons and sensors to a group requires our automation Z2M extension.')).toBeVisible();
  });
});
