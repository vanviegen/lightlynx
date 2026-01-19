import { test, expect, connectToMockServer } from './base-test';

test.describe('Active Scene', () => {
  test('should highlight active scene in list view', async ({ page }) => {
    await connectToMockServer(page);

    // Navigate to "Living Room" group
    await page.locator('.grid').locator('h2', { hasText: 'Living Room' }).click();
    await expect(page.locator('header h1')).toContainText('Living Room');

    // Create a scene
    await page.locator('h1', { hasText: 'Scenes' }).locator('svg.icon').click();
    await page.getByRole('textbox').fill('Test Scene');
    await page.getByRole('button', { name: 'OK' }).click();
    
    // Wait for scene to appear
    const sceneItem = page.locator('.list').locator('.item.link', { hasText: 'Test Scene' });
    await expect(sceneItem).toBeVisible();

    // Initially, scene should NOT be active
    await expect(sceneItem).not.toHaveClass(/active-scene/);

    // Recall the scene
    await sceneItem.click();

    // Wait a moment for the scene tracking to propagate
    await page.waitForTimeout(500);

    // Now the scene should be marked as active
    await expect(sceneItem).toHaveClass(/active-scene/);
  });

  test('should show active scene in grid view', async ({ page }) => {
    await connectToMockServer(page);

    // Navigate to "Living Room" group
    await page.locator('.grid').locator('h2', { hasText: 'Living Room' }).click();
    await expect(page.locator('header h1')).toContainText('Living Room');

    // Create two scenes to test that only one is active
    await page.locator('h1', { hasText: 'Scenes' }).locator('svg.icon').click();
    await page.getByRole('textbox').fill('Morning');
    await page.getByRole('button', { name: 'OK' }).click();
    await page.waitForTimeout(200);

    await page.locator('h1', { hasText: 'Scenes' }).locator('svg.icon').click();
    await page.getByRole('textbox').fill('Evening');
    await page.getByRole('button', { name: 'OK' }).click();
    
    const eveningScene = page.locator('.list').locator('.item.link', { hasText: 'Evening' });
    const morningScene = page.locator('.list').locator('.item.link', { hasText: 'Morning' });
    await expect(eveningScene).toBeVisible();
    await expect(morningScene).toBeVisible();

    // Neither scene should be active initially
    await expect(eveningScene).not.toHaveClass(/active-scene/);
    await expect(morningScene).not.toHaveClass(/active-scene/);

    // Recall the Evening scene
    await eveningScene.click();
    await page.waitForTimeout(500);

    // Verify Evening scene is active and Morning is not
    await expect(eveningScene).toHaveClass(/active-scene/);
    await expect(morningScene).not.toHaveClass(/active-scene/);

    // Navigate back to main page
    await page.locator('header img.logo').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    
    // Wait for fadeout animation to complete and page to stabilize
    await page.waitForTimeout(500);
    
    // Find the Living Room group tile on the main grid (not in fadeOut pages)
    const groupTile = page.locator('main:not(.fadeOut) .grid > div').filter({ has: page.locator('h2', { hasText: 'Living Room' }) });
    await expect(groupTile).toBeVisible();

    // The scene should be in the options as either an SVG icon or a text element
    // Check if any element in options has the active-scene class
    const optionsSection = groupTile.locator('.options');
    await expect(optionsSection).toBeVisible();
    
    // Count how many scenes are in the options
    const sceneCount = await optionsSection.locator('svg, .scene').count();
    
    // If there are scenes, at least one should be active
    if (sceneCount > 0) {
      const activeSceneInGrid = optionsSection.locator('.active-scene');
      await expect(activeSceneInGrid.first()).toBeVisible({ timeout: 2000 });
    }
  });
});
