
import { test, expect, connectToMockServer } from './base-test';

test.describe('Automation Features', () => {
  test('should show automation UI elements in admin mode', async ({ page }) => {
    await connectToMockServer(page);
    
    // Ensure we are in admin mode
    await page.goto('/?admin=y');

    // Verify we're connected (Users section shows admin user)
    await expect(page.locator('h2', { hasText: 'admin' })).toBeVisible({ timeout: 15000 });
    
    // Find the Automation toggle checkbox in the Management section
    const automationLabel = page.locator('label.item').filter({ has: page.locator('h2', { hasText: 'Automation' }) });
    await expect(automationLabel).toBeVisible();
    
    const automationCheckbox = automationLabel.locator('input[type="checkbox"]');
    await expect(automationCheckbox).toBeVisible();
    
    // Automation toggle should exist (we're not testing the state or toggling, just that it's there)
    
    // Go to a group page and verify "Buttons and sensors" section exists
    const groupName = 'Living Room';
    await page.locator('.list h2.link', { hasText: groupName }).filter({ visible: true }).click();
    await expect(page.locator('span.subTitle', { hasText: 'group' }).filter({ visible: true })).toBeVisible();
    
    // "Buttons and sensors" heading should be visible
    const buttonsHeading = page.locator('h1', { hasText: 'Buttons and sensors' }).filter({ visible: true });
    await expect(buttonsHeading).toBeVisible();
    
    // Note: Whether the create icon appears depends on automation being enabled,
    // which is controlled by the extension's config. We're just verifying the section exists.
  });
});
