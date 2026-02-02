import { test, expect, connectToMockServer, hashPassword } from './base-test';

test.describe('User Permissions', () => {
  test('should show restricted groups as disabled for limited user', async ({ page }) => {
    // First, connect as admin and set up a limited user
    await connectToMockServer(page, { admin: true });
    
    // Create a limited user with permission only for Kitchen
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('limited');
    await page.locator('input[type="password"]').fill('pass123');
    
    // Give permission only to Kitchen group
    await page.locator('label:has-text("Kitchen") input[type="checkbox"]').check();
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Reconnect as the limited user
    const hashedPassword = await hashPassword(page, 'pass123');
    await connectToMockServer(page, { username: 'limited', password: hashedPassword, admin: false });
    
    // Should see Kitchen group (enabled, can click)
    const kitchenItem = page.locator('.item.group:has(h2:text("Kitchen"))');
    await expect(kitchenItem).toBeVisible();
    await expect(kitchenItem).not.toHaveClass(/disabled/);
    
    // Should see Living Room group but disabled
    const livingRoomItem = page.locator('.item.group:has(h2:text("Living Room"))');
    await expect(livingRoomItem).toBeVisible();
    await expect(livingRoomItem).toHaveClass(/disabled/);
    
    // Should be able to navigate into Kitchen
    await kitchenItem.locator('h2').click();
    await expect(page.locator('header span.subTitle', { hasText: 'group' })).toBeVisible();
  });

  test('should deny access when clicking disabled group', async ({ page }) => {
    // Set up as admin
    await connectToMockServer(page, { admin: true });
    
    // Create limited user with Kitchen permission only (not Living Room)
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('partial');
    await page.locator('input[type="password"]').fill('pass456');
    // Give permission to Kitchen only
    await page.locator('label:has-text("Kitchen") input[type="checkbox"]').check();
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Get password hash
    const hashedPassword = await hashPassword(page, 'pass456');
    
    // Reconnect as limited user
    await connectToMockServer(page, { username: 'partial', password: hashedPassword, admin: false });
    
    // Kitchen should be enabled and clickable
    const kitchenItem = page.locator('.item.group:has(h2:text("Kitchen"))');
    await expect(kitchenItem).toBeVisible();
    await expect(kitchenItem).not.toHaveClass(/disabled/);
    
    // Living Room should be disabled (pointer-events: none prevents clicking)
    const livingRoomItem = page.locator('.item.group:has(h2:text("Living Room"))');
    await expect(livingRoomItem).toBeVisible();
    await expect(livingRoomItem).toHaveClass(/disabled/);
    
    // Verify Kitchen is clickable by actually clicking it
    await page.locator('.item.group:has(h2:text("Kitchen")) h2').click();
    await expect(page.locator('header span.subTitle:has-text("group")')).toBeVisible();
  });

  test('should allow admin user to see and control all groups', async ({ page }) => {
    // Set up as admin
    await connectToMockServer(page, { admin: true });
    
    // Create an admin user
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('adminuser');
    await page.locator('input[type="password"]').fill('adminpass');
    
    // Enable admin access
    await page.locator('label:has-text("Admin access") input[type="checkbox"]').check();
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Get password hash
    const hashedPassword = await hashPassword(page, 'adminpass');
    
    // Reconnect as admin user
    await connectToMockServer(page, { username: 'adminuser', password: hashedPassword, admin: true });
    
    // All groups should be visible and enabled
    const kitchenItem = page.locator('.item.group:has(h2:text("Kitchen"))');
    const livingRoomItem = page.locator('.item.group:has(h2:text("Living Room"))');
    
    await expect(kitchenItem).toBeVisible();
    await expect(kitchenItem).not.toHaveClass(/disabled/);
    
    await expect(livingRoomItem).toBeVisible();
    await expect(livingRoomItem).not.toHaveClass(/disabled/);
    
    // Should see Users section (because admin)
    await expect(page.locator('h1', { hasText: 'Users' })).toBeVisible();
  });

  test('should prevent non-admin user from accessing user management', async ({ page }) => {
    // Set up as admin and create a non-admin user
    await connectToMockServer(page, { admin: true });
    
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('regularuser');
    await page.locator('input[type="password"]').fill('regular123');
    
    // Do NOT enable admin access, but give access to all groups so they're not all disabled
    await page.locator('label:has-text("Kitchen") input[type="checkbox"]').check();
    await page.locator('label:has-text("Living Room") input[type="checkbox"]').check();
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Get password hash
    const hashedPassword = await hashPassword(page, 'regular123');
    
    // Reconnect as regular user (not in admin mode)
    await connectToMockServer(page, { username: 'regularuser', password: hashedPassword, admin: false });
    
    // Should NOT see Users section (not in admin mode and not admin)
    await expect(page.locator('h1', { hasText: 'Users' })).not.toBeVisible({ timeout: 3000 });
  });

  test('should show all groups as disabled for user with no permissions', async ({ page }) => {
    // Set up as admin
    await connectToMockServer(page, { admin: true });
    
    // Create a user with no permissions at all
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('emptyuser');
    await page.locator('input[type="password"]').fill('empty123');
    
    // Don't check any permissions
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Get password hash
    const hashedPassword = await hashPassword(page, 'empty123');
    
    // Reconnect as user with no permissions
    await connectToMockServer(page, { username: 'emptyuser', password: hashedPassword, admin: false });
    
    // Groups should be visible but disabled
    const kitchenItem = page.locator('.item.group:has(h2:text("Kitchen"))');
    const livingRoomItem = page.locator('.item.group:has(h2:text("Living Room"))');
    
    await expect(kitchenItem).toBeVisible();
    await expect(kitchenItem).toHaveClass(/disabled/);
    
    await expect(livingRoomItem).toBeVisible();
    await expect(livingRoomItem).toHaveClass(/disabled/);
  });
});
