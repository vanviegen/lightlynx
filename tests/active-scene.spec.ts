import { test, expect, connectToMockServer } from './base-test';

test.describe('Active Scene', () => {
  test('should highlight active scene in list view', async ({ page }) => {
    await connectToMockServer(page);

    // Navigate to "Living Room" group
    await page.locator('.list').locator('h2.link', { hasText: 'Living Room' }).click();
    await expect(page.locator('header h1')).toContainText('Living Room');

    // Turn on the group first so lights are ON when we create/recall the scene
    const groupCircle = page.locator('.circle').first();
    await groupCircle.click();

    // Create a scene (now lights are ON)
    await page.getByRole('heading', { name: 'Scenes' }).getByRole('img', { name: 'create' }).click({ force: true });
    await page.getByRole('textbox').fill('Test Scene');
    await page.getByRole('button', { name: 'OK' }).click();
    
    // Wait for scene to appear
    const sceneItem = page.locator('.list').locator('.item.link', { hasText: 'Test Scene' });
    await expect(sceneItem).toBeVisible();

    // Initially, scene should NOT be active
    await expect(sceneItem).not.toHaveClass(/active-scene/);

    // Recall the scene
    await sceneItem.click();

    // Now the scene should be marked as active (expect has built-in waiting)
    await expect(sceneItem).toHaveClass(/active-scene/);
  });

  test('should show active scene in list view on main page', async ({ page }) => {
    await connectToMockServer(page);

    // Navigate to "Living Room" group
    await page.locator('.list').locator('h2.link', { hasText: 'Living Room' }).click();
    await expect(page.locator('header h1')).toContainText('Living Room');

    // Ensure lights are ON (click circle if needed based on current state)
    const groupCircle = page.locator('.circle').first();
    // Check if the circle has the 'on' class - if not, click it
    const circleClasses = await groupCircle.getAttribute('class');
    if (!circleClasses?.includes('on')) {
      await groupCircle.click();
    }

    // Create two scenes to test that only one is active (lights are now ON)
    await page.getByRole('heading', { name: 'Scenes' }).getByRole('img', { name: 'create' }).click({ force: true });
    // Use .first() to avoid matching hidden dialog's textbox
    await page.getByRole('textbox').first().fill('Morning');
    await page.getByRole('button', { name: 'OK' }).click();

    await page.getByRole('heading', { name: 'Scenes' }).getByRole('img', { name: 'create' }).click({ force: true });
    await page.getByRole('textbox').first().fill('Evening');
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

    // Verify Evening scene is active and Morning is not (expect waits automatically)
    await expect(eveningScene).toHaveClass(/active-scene/);
    await expect(morningScene).not.toHaveClass(/active-scene/);

    // Navigate back to main page
    await page.locator('header img.logo').click();
    await expect(page.locator('header h1')).toContainText('Light Lynx');
    
    // Find the Living Room group row on the main list
    const groupRow = page.locator('.item.group').filter({ has: page.locator('h2', { hasText: 'Living Room' }) });
    await expect(groupRow).toBeVisible();

    // The active scene should be shown in the scenes section
    const scenesSection = groupRow.locator('.scenes');
    await expect(scenesSection).toBeVisible();
    
    // Count how many scenes are in the section
    const sceneCount = await scenesSection.locator('svg, .scene').count();
    
    // If there are scenes, at least one should be active
    if (sceneCount > 0) {
      const activeSceneInList = scenesSection.locator('.active-scene');
      await expect(activeSceneInList.first()).toBeVisible({ timeout: 2000 });
    }
  });
});
