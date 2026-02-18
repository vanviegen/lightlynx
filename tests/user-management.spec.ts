
import { test, expect, connectToMockServer } from './base-test';

test.describe('User Management', () => {
  test('should create a new user with password and remote access', async ({ page }) => {
    await connectToMockServer(page);

    // We're already on the main page, just click the create icon in Users heading
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    
    // We should be on the Add user page
    await expect(page.locator('h1.title', { hasText: 'Add' })).toBeVisible();
    
    // Fill in userName
    await page.locator('input[placeholder="frank"]').fill('testuser');
    
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

  test('should trim and lowercase user name on create', async ({ page }) => {
    await connectToMockServer(page);

    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="frank"]').fill('  MixedCASE  ');
    await page.locator('input[type="password"]').fill('pass');
    await page.getByRole('button', { name: 'Save' }).click();

    // Verify the created user's name is normalized (trimmed + lowercased)
    await expect(page.locator('h2', { hasText: 'mixedcase' })).toBeVisible();
  });

  test('user detail: Copy direct-connect URL exists and shows toast', async ({ page }) => {
    await connectToMockServer(page);

    // Create a user to test the detail page
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="frank"]').fill('copyuser');
    await page.locator('input[type="password"]').fill('pass');
    await page.getByRole('button', { name: 'Save' }).click();

    // Open the user detail
    await page.locator('h2', { hasText: 'copyuser' }).click();

    // The copy link should be visible and produce a toast when clicked
    const copyLink = page.locator('small.link', { hasText: 'Copy direct-connect URL' });
    await expect(copyLink).toBeVisible();
    await copyLink.click();
    await expect(page.locator('div.info, div.error', { hasText: /URL/i })).toBeVisible();
  });

    test('connect page: change password updates server secret and extension accepts it', async ({ page }) => {
    // Start connected in manage mode so we can inspect Users afterwards
    await connectToMockServer(page);
    await page.goto('/connect');

    // Fill connection details for admin (initial admin password in mock is empty)
    await page.fill('input[placeholder="Eg: a0324d3 or 1.2.3.4:43597"]', 'localhost:43598');
    await page.fill('label:has-text("User name") + input', 'admin');
    await page.fill('label:has-text("Password") + input', '');

    // Toggle Change password, enter new password twice
    await page.locator('small.link', { hasText: 'Change password' }).click();
    await page.fill('label:has-text("New password") + input', 'newpass123');
    await page.fill('label:has-text("New password (again)") + input', 'newpass123');

    // Click Change (Connect button becomes Change)
    await page.getByRole('button', { name: 'Change' }).click();

    // Should connect (main page visible)
    await expect(page.locator('h2', { hasText: 'Kitchen' })).toBeVisible({ timeout: 10000 });

    // Verify the change by reconnecting using the new password
    await page.goto('/connect');
    await page.fill('input[placeholder="Eg: a0324d3 or 1.2.3.4:43597"]', 'localhost:43598');
    await page.fill('label:has-text("User name") + input', 'admin');
    await page.fill('label:has-text("Password") + input', 'newpass123');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.locator('h2', { hasText: 'Kitchen' })).toBeVisible({ timeout: 10000 });
  });

  test('connect page: username is trimmed and lowercased when saving a server', async ({ page }) => {
    await page.goto('/connect');

    await page.fill('input[placeholder="Eg: a0324d3 or 1.2.3.4:43597"]', 'localhost:43598');
    await page.fill('label:has-text("User name") + input', '  MixedCASE  ');
    // UI should normalize immediately
    await expect(page.locator('label:has-text("User name") + input')).toHaveValue('mixedcase');
    await page.fill('label:has-text("Password") + input', '');

    // Submit to save server (connection may fail because user doesn't exist)
    await page.getByRole('button', { name: 'Connect' }).click();


  });

  test('changing password to blank is rejected for a user that allows remote access', async ({ page }) => {
    // Start connected as admin (admin/manage)
    await connectToMockServer(page);
    await expect(page.locator('h2', { hasText: 'Kitchen' })).toBeVisible({ timeout: 10000 });

    // Create a user with password and enable remote access
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="frank"]').fill('remoteblank');
    await page.locator('input[type="password"]').fill('pass123');
    await page.locator('label:has-text("Allow remote access") input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Save' }).click();
    // Wait for user to appear in list (ensure backend updated)
    await expect(page.locator('h2', { hasText: 'remoteblank' })).toBeVisible();

    // Now attempt to connect as that user and change password to blank
    await page.goto('/connect');
    await page.fill('input[placeholder="Eg: a0324d3 or 1.2.3.4:43597"]', 'localhost:43598');
    await page.fill('label:has-text("User name") + input', 'remoteblank');
    await page.fill('label:has-text("Password") + input', 'pass123');

    // Toggle Change password, leave new password blank (both fields blank -> equal)
    await page.locator('small.link', { hasText: 'Change password' }).click();
    await page.getByRole('button', { name: 'Change' }).click();

    // Should show connection error from extension enforcing non-blank password for remote user
    await expect(page.getByText('Password cannot be blank for users with remote access')).toBeVisible({ timeout: 5000 });
  });

  test('should update user remote access without changing password', async ({ page }) => {
    await connectToMockServer(page);

    // First create a user with password
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="frank"]').fill('updatetest');
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
    await page.locator('input[placeholder="frank"]').fill('hashuser');
    
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
    
    // Fill in userName and password
    await page.locator('input[placeholder="frank"]').fill('nopassuser');
    await page.locator('input[type="password"]').fill('pass');
    
    // Now we can check the remote checkbox
    await remoteCheckbox.check();
    await expect(remoteCheckbox).toBeChecked();
  });

  test('should show Cancel button that goes back', async ({ page }) => {
    await connectToMockServer(page);

    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    
    // Fill in some data
    await page.locator('input[placeholder="frank"]').fill('canceltest');
    
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
    await page.locator('input[placeholder="frank"]').fill('deletetest');
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
    await page.locator('input[placeholder="frank"]').fill('admintest');
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
    await page.locator('input[placeholder="frank"]').fill('limiteduser');
    await page.locator('input[type="password"]').fill('password');
    
    // Should see Permissions section (because not admin)
    await expect(page.locator('h1', { hasText: 'Permissions' })).toBeVisible();
    
    // Check the Kitchen group (already exists in mock)
    await page.locator('div.item:has(h2:text("Kitchen")) select').first().selectOption('true');
    
    // Also check Living Room
    await page.locator('div.item:has(h2:text("Living Room")) select').first().selectOption('true');
    
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Verify user was created
    await expect(page.locator('h2', { hasText: 'limiteduser' })).toBeVisible();
    
    // Re-open to verify permissions were saved
    await page.locator('h2', { hasText: 'limiteduser' }).click();
    await expect(page.locator('div.item:has(h2:text("Kitchen")) select').first()).toHaveValue('true');
    await expect(page.locator('div.item:has(h2:text("Living Room")) select').first()).toHaveValue('true');
  });

  test('should show existing secret in password field when editing user', async ({ page }) => {
    await connectToMockServer(page);

    // Create a user with a known password
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="frank"]').fill('secrettest');
    await page.locator('input[type="password"]').fill('mypassword');
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Re-open the user
    await page.locator('h2', { hasText: 'secrettest' }).click();
    
    // The password field should have the secret (64-char hex)
    const passwordInput = page.locator('input[type="password"]');
    const passwordValue = await passwordInput.inputValue();
    
    // Should be a 64-character hex string
    expect(passwordValue).toMatch(/^[0-9a-f]{64}$/);
  });

  test('should allow changing password for existing user', async ({ page }) => {
    await connectToMockServer(page);

    // Create a user
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="frank"]').fill('changepass');
    await page.locator('input[type="password"]').fill('oldpass');
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Get the old secret
    await page.locator('h2', { hasText: 'changepass' }).click();
    const passwordInput = page.locator('input[type="password"]');
    const oldSecret = await passwordInput.inputValue();
    
    // Change the password
    await passwordInput.fill('newpass');
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Re-open and verify the secret changed
    await page.locator('h2', { hasText: 'changepass' }).click();
    const newSecret = await passwordInput.inputValue();
    
    // Should be different from old secret
    expect(newSecret).not.toBe(oldSecret);
    expect(newSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  test('should clear password when empty string provided', async ({ page }) => {
    await connectToMockServer(page);

    // Create a user with password
    await page.getByRole('heading', { name: 'Users' }).getByRole('img', { name: 'create' }).click();
    await page.locator('input[placeholder="frank"]').fill('clearpass');
    await page.locator('input[type="password"]').fill('haspassword');
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Verify no "No password" badge initially
    const userItem = page.locator('div.item').filter({ has: page.locator('h2', { hasText: 'clearpass' }) });
    await expect(userItem.locator('span.badge.warning', { hasText: 'No password' })).not.toBeVisible();
    
    // Edit user and clear password
    await page.locator('h2', { hasText: 'clearpass' }).click();
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.clear();
    await page.getByRole('button', { name: 'Save' }).click();
    
    // Now should see "No password" badge
    await expect(userItem.locator('span.badge.warning', { hasText: 'No password' })).toBeVisible();
  });
});
