
import { test, expect, connectToMockServer } from './base-test';

test.describe('User Management', () => {
  test('should create a new user with password and remote access', async ({ page }) => {
    await connectToMockServer(page);

    // We're already on the main page, just click the create icon in Users heading
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    
    // We should be on the New User page
    await expect(page.locator('h1.title', { hasText: 'New User' })).toBeVisible();
    
    // Fill in username
    await page.locator('input[placeholder="Username"]').fill('testuser');
    
    // Fill in password
    await page.locator('input[type="password"]').fill('testpass123');
    
    // Enable remote access
    await page.locator('label:has-text("Allow remote access") input[type="checkbox"]').check();
    
    // Click Save
    await page.getByRole('button', { name: 'Save' }).click();
    
    // We should be back on the users list
    await expect(page.locator('h2', { hasText: 'testuser' })).toBeVisible();
    
    // Verify the user has "Remote" badge
    const userItem = page.locator('div.item:has(h2:text("testuser"))');
    await expect(userItem.locator('span.badge', { hasText: 'Remote' })).toBeVisible();
    
    // Click on the user to edit
    await page.locator('h2', { hasText: 'testuser' }).click();
    
    // Verify remote access is still checked (scope to visible main to avoid fadeOut duplicates)
    const remoteCheckbox = page.locator('label:has-text("Allow remote access") input[type="checkbox"]');
    await expect(remoteCheckbox).toBeChecked();
  });

  test('should update user remote access without changing password', async ({ page }) => {
    await connectToMockServer(page);

    // First create a user with password
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('updatetest');
    await page.locator('input[type="password"]').fill('password123');
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Now edit the user to enable remote access
    await page.locator('h2', { hasText: 'updatetest' }).click();
    await page.locator('label:has-text("Allow remote access") input[type="checkbox"]').check();
    
    // Save without entering password (should keep existing password)
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Back to users list
    await expect(page.locator('h2', { hasText: 'updatetest' })).toBeVisible();
    
    // Verify the user has "Remote" badge
    const userItem = page.locator('div.item:has(h2:text("updatetest"))');
    await expect(userItem.locator('span.badge', { hasText: 'Remote' })).toBeVisible();
    
    // Re-open user to verify remote access is still enabled
    await page.locator('h2', { hasText: 'updatetest' }).click();
    const remoteCheckbox = page.locator('label:has-text("Allow remote access") input[type="checkbox"]');
    await expect(remoteCheckbox).toBeChecked();
  });

  test('should accept password hash in password field', async ({ page }) => {
    await connectToMockServer(page);

    // Create a user with a hash directly
    const testHash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'; // SHA-256 hash example
    
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('hashuser');
    
    // Enter the hash directly
    await page.locator('input[type="password"]').fill(testHash);
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Verify user was created
    await expect(page.locator('h2', { hasText: 'hashuser' })).toBeVisible();
    
    // The user should not have "No password" badge (meaning password was set)
    const userItem = page.locator('div.item').filter({ has: page.locator('h2', { hasText: 'hashuser' }) });
    await expect(userItem.locator('span.badge.warning', { hasText: 'No password' })).not.toBeVisible();
  });

  test('should disable remote access checkbox when no password', async ({ page }) => {
    await connectToMockServer(page);

    // Create a user without password
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    
    // Don't fill password - the remote checkbox should be disabled when there's no password
    const remoteCheckbox = page.locator('label:has-text("Allow remote access") input[type="checkbox"]');
    
    // Remote access should initially be unchecked (not necessarily disabled)
    await expect(remoteCheckbox).not.toBeChecked();
    
    // Fill in username and password
    await page.locator('input[placeholder="Username"]').fill('nopassuser');
    await page.locator('input[type="password"]').fill('pass');
    
    // Now we can check the remote checkbox
    await remoteCheckbox.check();
    await expect(remoteCheckbox).toBeChecked();
  });

  test('should show Cancel button that goes back', async ({ page }) => {
    await connectToMockServer(page);

    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    
    // Fill in some data
    await page.locator('input[placeholder="Username"]').fill('canceltest');
    
    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();
    
    // Should be back on users list, and canceltest should not exist
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'canceltest' })).not.toBeVisible({ timeout: 3000 });
  });

  test('should delete user', async ({ page }) => {
    await connectToMockServer(page);

    // Create a user
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('deletetest');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Verify user exists
    await expect(page.locator('h2', { hasText: 'deletetest' })).toBeVisible();
    
    // Click on user
    await page.locator('h2', { hasText: 'deletetest' }).click();
    
    // Click Delete
    await page.locator('button.danger', { hasText: 'Delete user' }).click();
    
    // Confirm in the prompt (Yes button)
    await page.getByRole('button', { name: 'Yes' }).click();
    
    // Should be back on users list, and deletetest should not exist
    await expect(page.locator('h2', { hasText: 'deletetest' })).not.toBeVisible();
  });

  test('should set admin access for user', async ({ page }) => {
    await connectToMockServer(page);

    // Create a regular user
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('admintest');
    await page.locator('input[type="password"]').fill('password');
    
    // Enable admin access
    await page.locator('label:has-text("Admin access") input[type="checkbox"]').check();
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Verify user has shield icon (admin)
    const userItem = page.locator('div.item').filter({ has: page.locator('h2', { hasText: 'admintest' }) });
    await expect(userItem.locator('svg[aria-label="shield"]')).toBeVisible();
  });

  test('should set permissions for non-admin user', async ({ page }) => {
    await connectToMockServer(page);

    // Mock server already has groups (Kitchen, Living Room, Test Group)
    // So we don't need to create one
    
    // Create a user
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="Username"]').fill('limiteduser');
    await page.locator('input[type="password"]').fill('password');
    
    // Should see Permissions section (because not admin)
    await expect(page.locator('h1', { hasText: 'Permissions' })).toBeVisible();
    
    // Check the Kitchen group (already exists in mock)
    await page.locator('label:has-text("Kitchen") input[type="checkbox"]').check();
    
    // Also check Living Room
    await page.locator('label:has-text("Living Room") input[type="checkbox"]').check();
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Verify user was created
    await expect(page.locator('h2', { hasText: 'limiteduser' })).toBeVisible();
    
    // Re-open to verify permissions were saved
    await page.locator('h2', { hasText: 'limiteduser' }).click();
    await expect(page.locator('label:has-text("Kitchen") input[type="checkbox"]')).toBeChecked();
    await expect(page.locator('label:has-text("Living Room") input[type="checkbox"]')).toBeChecked();
  });
});
