
import { test, expect } from '@playwright/test';

const MOCK_Z2M_PORT = '25834';

async function connectToMockServer(page) {
    // 1. Go to the app in admin mode
    await page.goto('/?admin=y');

    // 2. Check if already connected (look for Management header)
    const isConnected = await page.locator('h1', { hasText: 'Management' }).isVisible().catch(() => false);
    
    if (!isConnected) {
        // Go to connect page
        await page.click('text=Connect to a server');
        
        // 3. Fill connection details
        await page.fill('input[placeholder="your-server.com"]', '127.0.0.1');
        await page.fill('input[type="number"]', MOCK_Z2M_PORT);
        
        // Uncheck HTTPS
        const httpsCheckbox = page.locator('input[type="checkbox"]');
        if (await httpsCheckbox.isChecked()) {
            await httpsCheckbox.uncheck();
        }
        
        await page.click('button[type="submit"]');
        
        // Wait for redirection to main page
        await expect(page.locator('h1', { hasText: 'Management' })).toBeVisible({ timeout: 10000 });
    }
}

test.describe('Extension Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Log console messages for debugging
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.text().includes('api')) {
            console.log('BROWSER:', msg.text());
        }
    });
  });

  test('should install and uninstall extensions', async ({ page }) => {
    await connectToMockServer(page);
    
    // Ensure we are in admin mode
    await page.goto('/?admin=y');

    // --- TEST API EXTENSION ---

    // 1. Verify API is not installed initially (Users section shows prompt)
    const usersSection = page.locator('h1', { hasText: 'Users' }).locator('xpath=..');
    await expect(page.locator('text=The Light Lynx API extension is required for user management.')).toBeVisible();
    
    // 2. Install API extension
    const installApiBtn = page.getByRole('button', { name: 'Install' }).first();
    await installApiBtn.click();
    
    // 3. Verify API is installed (Users section shows admin user)
    // It might take a moment for the extension to start and the app to refresh
    await expect(page.locator('h2', { hasText: 'admin' })).toBeVisible({ timeout: 15000 });

    // --- TEST AUTOMATION EXTENSION ---

    // 4. Go to a group page and verify Automation is NOT present
    // First find a group (main page)
    await page.goto('/?admin=y');
    const groupName = 'Living Room'; // From mock-z2m.ts
    await page.locator('h2', { hasText: groupName }).click();
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();
    await expect(page.locator('h1', { hasText: 'Automation' })).not.toBeVisible();

    // 5. Go back and install Automation extension
    await page.goto('/?admin=y');
    
    // Scroll to extensions section
    const extensionsHeader = page.locator('h1', { hasText: 'Z2M Extensions' });
    await extensionsHeader.scrollIntoViewIfNeeded();

    // Find the automation item and its install button
    // It's in a list, we want the "Install" (plus) icon for automation
    const automationItem = page.locator('div.item', { has: page.locator('h2', { hasText: 'automation' }) });
    const installAutomationBtn = automationItem.locator('svg.icon').last(); // Icons are create/remove
    
    await installAutomationBtn.click();

    // 6. Verify Automation is installed (go to group page)
    await page.locator('h2', { hasText: groupName }).click();
    await expect(page.locator('h1', { hasText: 'Buttons and sensors' })).toBeVisible({ timeout: 10000 });

    // --- TEST UNINSTALL ---

    // Automatically accept all dialogs
    page.on('dialog', dialog => dialog.accept());

    // 7. Uninstall Automation
    await page.goto('/?admin=y');
    await extensionsHeader.scrollIntoViewIfNeeded();
    
    const automationItemAgain = page.locator('div.item', { has: page.locator('h2', { hasText: 'automation' }) });
    const removeAutomationBtn = automationItemAgain.locator('svg.icon').last();
    await removeAutomationBtn.click();

    // 8. Verify Automation is gone
    await page.locator('h2', { hasText: groupName }).click();
    await expect(page.locator('text=Connecting buttons and sensors to a group requires our automation Z2M extension.')).toBeVisible();

    // 9. Uninstall API
    await page.goto('/?admin=y');
    await extensionsHeader.scrollIntoViewIfNeeded();

    const apiItem = page.locator('div.item', { has: page.locator('h2', { hasText: 'api' }) });
    const removeApiBtn = apiItem.locator('svg.icon').last();
    await removeApiBtn.click();

    // 10. Verify API is gone (Users section shows prompt again)
    await expect(page.locator('text=The Light Lynx API extension is required for user management.')).toBeVisible({ timeout: 10000 });
  });
});
