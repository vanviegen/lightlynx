
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
    await page.getByRole('textbox').fill(groupName);
    await page.getByRole('button', { name: 'OK' }).click();

    // Verify we're automatically navigated to the group detail view
    await expect(page.locator('h1.title', { hasText: groupName })).toBeVisible();
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();

    // 7. Add lights to the group
    // Select the icon in the Bulbs section of the active group page
    // Note: Use force: true because Playwright's hit testing sometimes gets confused by 
    // overlapping transition containers in this complex integration test.
    await page.getByRole('heading', { name: 'Bulbs' }).getByRole('img', { name: 'create' }).click({ force: true });
    await expect(page.locator('span.subTitle', { hasText: 'add light' })).toBeVisible();

    // Add "Living Room Ceiling 1"
    await page.locator('h2', { hasText: 'Living Room Ceiling 1' }).click();
    // After adding, it should go back to group page
    await expect(page.locator('span.subTitle', { hasText: 'add light' })).not.toBeVisible();
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();
    // Use filter({ visible: true }) to pick the matching visible one
    await expect(page.locator('h2', { hasText: 'Living Room Ceiling 1' })).toBeVisible();

    // Add another "Kitchen Ceiling"
    await page.getByRole('heading', { name: 'Bulbs' }).getByRole('img', { name: 'create' }).click({ force: true });
    await page.locator('h2', { hasText: 'Kitchen Ceiling' }).click();
    await expect(page.locator('span.subTitle', { hasText: 'add light' })).not.toBeVisible();
    await expect(page.locator('span.subTitle', { hasText: 'group' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Kitchen Ceiling' })).toBeVisible();

    // 8. Create a scene
    const sceneName = 'Test Scene';
    
    // Click the "plus" icon in the Scenes header
    await page.getByRole('heading', { name: 'Scenes' }).getByRole('img', { name: 'create' }).click({ force: true });

    // Fill in the scene name in our custom prompt UI
    await page.getByRole('textbox').fill(sceneName);
    await page.getByRole('button', { name: 'OK' }).click();

    // Verify scene appears
    await expect(page.locator('h2', { hasText: sceneName })).toBeVisible();
    
    console.log('Integration test completed successfully!');
  });
});
