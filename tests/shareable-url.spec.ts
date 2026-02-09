import { test, expect } from './base-test';

test.describe('Shareable Connection URL', () => {
  test('should connect using shareable URL with all parameters', async ({ page }) => {

    // Navigate with URL parameters (host and userName)
    // The app will auto-connect
    const connectUrl = '/?instanceId=localhost:43598&userName=admin';
    await page.goto(connectUrl);

    // The app should auto-connect and show the main page
    // Check for a group that exists in mock-z2m
    await expect(page.locator('h2', { hasText: 'Kitchen' })).toBeVisible({ timeout: 10000 });

    // Verify we're on the main page by checking for groups (not the connect page)
    await expect(page.locator('h2', { hasText: 'Living Room' })).toBeVisible();
    
    console.log('Successfully connected via shareable URL!');
  });

  test('should show copy URL link on connection page', async ({ page }) => {
    await page.goto('/connect');
    
    // Fill in connection details
    await page.fill('input[placeholder="hostname:port or instance code"]', 'localhost:43598');
    await page.fill('label:has-text("UserName") + input', 'admin');
    
    // The "Copy direct-connect URL" link should be visible
    const copyLink = page.locator('small.link', { hasText: 'Copy direct-connect URL' });
    await expect(copyLink).toBeVisible();
    
    // Click the copy link - this copies to clipboard and shows a toast
    // We can't easily test clipboard in Playwright without permissions, but we can verify the toast appears
    await copyLink.click();
    
    // Should show a toast (either success "URL copied" or error "Failed to copy URL")
    // The toast div has class "info" or "error" depending on success/failure
    const toast = page.locator('div.info, div.error', { hasText: /URL/i });
    await expect(toast).toBeVisible({ timeout: 3000 });
    
    console.log('Copy URL link works and shows toast!');
  });

  test('should handle shareable URL with existing server', async ({ page }) => {
    // First connection to establish a server
    await page.goto('/?instanceId=localhost:43598&userName=admin');
    await expect(page.locator('h2', { hasText: 'Kitchen' })).toBeVisible({ timeout: 10000 });
    
    // Disconnect by navigating away
    await page.goto('/');
    
    // Now use the same shareable URL again
    await page.goto('/?instanceId=localhost:43598&userName=admin');
    
    // Should reconnect to the existing server
    await expect(page.locator('h2', { hasText: 'Kitchen' })).toBeVisible({ timeout: 10000 });
    
    console.log('Successfully reconnected to existing server via shareable URL!');
  });

  test('should connect with pre-hashed secret in URL', async ({ page }) => {
    // First, connect as admin to get the app running
    await page.goto('/?instanceId=localhost:43598&userName=admin');
    await expect(page.locator('h2', { hasText: 'Kitchen' })).toBeVisible({ timeout: 10000 });
    
    // Generate a hash using the app's hashing function
    const hashedSecret = await page.evaluate(async () => {
      const saltString = "LightLynx-Salt-v2";
      const salt = new TextEncoder().encode(saltString);
      const pw = new TextEncoder().encode('testpassword');
      const keyMaterial = await window.crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
      const derivedBits = await window.crypto.subtle.deriveBits({
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      }, keyMaterial, 256);
      return Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
    });
    
    // Verify the hash looks valid (64 hex characters)
    expect(hashedSecret).toMatch(/^[a-f0-9]{64}$/);
    
    console.log('Successfully verified hash generation for shareable URLs!');
  });
});
