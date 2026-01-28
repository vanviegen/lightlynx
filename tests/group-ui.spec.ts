import { test, expect, connectToMockServer } from './base-test';

test.describe('Group configuration UI', () => {
  test('should show Lights off timer controls and persist changes', async ({ page }) => {
    await connectToMockServer(page);

    const groupName = 'Living Room';
    
    // Enable automation (required for timer controls)
    page.locator('label.item h2', { hasText: 'Automation' }).click();
    
    // Open the group - the automation-dependent UI should be visible
    await page.locator('.list h2.link', { hasText: groupName }).filter({ visible: true }).click();
    await expect(page.locator('header h1').filter({ visible: true })).toContainText(groupName);

    // Ensure Settings header is present
    await expect(page.locator('h1', { hasText: 'Settings' }).filter({ visible: true })).toBeVisible();

    // Find the Lights off timer label and checkbox
    const timerLabel = page.locator('label.item').filter({ has: page.locator('h2', { hasText: 'Lights off timer' }) });
    await expect(timerLabel).toBeVisible();

    const checkbox = timerLabel.locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();

    // Check it to show timer controls
    await checkbox.check();

    // Timer inputs should appear: number input and select for unit
    const numberInput = page.locator('input[type="number"]');
    const unitSelect = page.locator('select');

    await expect(numberInput).toBeVisible();
    await expect(unitSelect).toBeVisible();

    // Default should be 30 and minutes
    await expect(numberInput).toHaveValue('30');
    await expect(unitSelect).toHaveValue('m');

    // Change to 15 hours
    await numberInput.fill('15');
    await unitSelect.selectOption('h');

    // Wait for lazySave to trigger and persist to backend
    await page.waitForTimeout(1500);

    // Navigate back to main and then back to group to verify persistence
    await page.locator('header img.logo').filter({ visible: true }).click();
    await expect(page.locator('header h1').filter({ visible: true })).toContainText('Light Lynx');

    // Re-open group
    await page.locator('.list h2.link', { hasText: groupName }).filter({ visible: true }).click();
    await expect(page.locator('header h1').filter({ visible: true })).toContainText(groupName);

    // Ensure the timer controls are still present and show our values
    const numberInput2 = page.locator('input[type="number"]');
    const unitSelect2 = page.locator('select');

    await expect(numberInput2).toHaveValue('15');
    await expect(unitSelect2).toHaveValue('h');
  });

  test('should delete group after confirmation', async ({ page }) => {
    await connectToMockServer(page);

    const groupName = 'Kitchen';
    // Open Kitchen group
    await page.locator('.list h2.link', { hasText: groupName }).filter({ visible: true }).click();
    await expect(page.locator('header h1').filter({ visible: true })).toContainText(groupName);

    // Find and click Delete group
    const deleteItem = page.locator('div.item.link', { hasText: 'Delete group' }).filter({ visible: true });
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    // Confirm dialog should appear; click Yes
    await expect(page.locator('button.primary', { hasText: 'Yes' }).filter({ visible: true })).toBeVisible();
    await page.locator('button.primary', { hasText: 'Yes' }).filter({ visible: true }).click();

    // After deletion, the group should no longer be visible on main list
    await expect(page.locator('.list h2.link', { hasText: groupName }).filter({ visible: true })).not.toBeVisible({ timeout: 10000 });
  });

  test('should open scene editor when clicking configure for a scene', async ({ page }) => {
    await connectToMockServer(page);

    const groupName = 'Living Room';
    await page.locator('.list h2.link', { hasText: groupName }).filter({ visible: true }).click();
    await expect(page.locator('header h1').filter({ visible: true })).toContainText(groupName);

    // Find the Bright scene and click its configure icon (second svg.icon in the item)
    const sceneItem = page.locator('.list').locator('.item.link', { hasText: 'Bright' }).filter({ visible: true });
    await expect(sceneItem).toBeVisible();

    // There is an icon (scene icon) then configure icon - click second
    const svgs = sceneItem.locator('svg.icon');
    const svgCount = await svgs.count();
    expect(svgCount >= 2).toBe(true);
    await svgs.nth(1).click({ force: true });

    // Scene editor page should show "Scene name" header
    await expect(page.locator('h1', { hasText: 'Scene name' }).filter({ visible: true })).toBeVisible();
  });
});
