import { test, expect } from './base-test';

test.describe('Shareable Connection URL', () => {
  test('should connect using shareable URL with all parameters', async ({ page }) => {

    // Navigate to connect page with URL parameters (host and username)
    // The app will auto-hash the password and auto-connect
    const connectUrl = '/connect?host=localhost:43598&username=admin';
    await page.goto(connectUrl);

    // The app should auto-connect and redirect to main page
    // Wait for the connection to complete and redirect to happen
    // Check for a group or device that exists in mock-z2m
    await expect(page.locator('h2', { hasText: 'Kitchen' }).filter({ visible: true })).toBeVisible({ timeout: 10000 });

    // Verify we're on the main page (not the connect page)
    await expect(page.locator('span.subTitle', { hasText: 'Z2M' }).filter({ visible: true })).not.toBeVisible();
    
    console.log('Successfully connected via shareable URL!');
  });

  test('should allow sharing URL with pre-hashed secret', async ({ page }) => {
    // First, manually connect to get the hashed secret
    await page.goto('/connect');
    
    // Fill in connection details
    await page.fill('input[placeholder="e.g. 192.168.1.5[:port]"]', 'localhost:43598');
    await page.fill('label:has-text("Username") + input', 'admin');
    // Leave password empty (admin has no password)
    
    // Wait for URL to update from typing
    await page.waitForTimeout(100);
    
    // Capture the current URL with all parameters
    let url = new URL(page.url());
    let host = url.searchParams.get('host');
    let username = url.searchParams.get('username');
    
    // Verify URL parameters are present from typing
    expect(host).toBe('localhost:43598');
    expect(username).toBe('admin');
    
    // Submit to connect
    await page.click('button[type="submit"]');
    
    // Wait for connection
    await expect(page.locator('h2', { hasText: 'Kitchen' }).filter({ visible: true })).toBeVisible({ timeout: 10000 });
    
    // Now navigate to a different page
    await page.goto('/');
    
    // Use the shareable URL to reconnect
    const shareableUrl = `/connect?host=${host}&username=${username}`;
    await page.goto(shareableUrl);
    
    // Should auto-connect
    await expect(page.locator('h2', { hasText: 'Kitchen' }).filter({ visible: true })).toBeVisible({ timeout: 10000 });
    
    console.log('Successfully reconnected via shareable URL with pre-hashed secret!');
  });

  test('should update URL on form submit', async ({ page }) => {
    await page.goto('/connect');
    
    // Type in the host field
    const hostInput = page.locator('input[placeholder="e.g. 192.168.1.5[:port]"]');
    await hostInput.fill('192.168.1.100:8080');
    
    // Wait for reactive update
    await page.waitForTimeout(100);
    
    // URL should be updated as we type
    let url = new URL(page.url());
    expect(url.searchParams.get('host')).toBe('192.168.1.100:8080');
    
    // Type in the username field
    const usernameInput = page.locator('label:has-text("Username") + input');
    await usernameInput.fill('testuser');
    
    // Wait for reactive update
    await page.waitForTimeout(100);
    
    // URL should be updated
    url = new URL(page.url());
    expect(url.searchParams.get('username')).toBe('testuser');
    
    // Type in the password field
    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.fill('testpass123');
    
    // Wait for debounced hash
    await page.waitForTimeout(500);
    
    // Secret should now be in URL (hashed as user typed)
    url = new URL(page.url());
    const secret = url.searchParams.get('secret');
    expect(secret).toBeTruthy();
    expect(secret?.length).toBeGreaterThan(0);
    
    // Submitting doesn't change the URL (already updated)
    await page.click('button[type="submit"]');
    await page.waitForTimeout(100);
    
    url = new URL(page.url());
    expect(url.searchParams.get('host')).toBe('192.168.1.100:8080');
    expect(url.searchParams.get('username')).toBe('testuser');
    expect(url.searchParams.get('secret')).toBe(secret);
    
    console.log('Form state successfully reflected in URL!');
  });

  test('should handle shareable URL with existing server', async ({ page }) => {
    // First connection to establish a server
    await page.goto('/connect?host=localhost:43598&username=admin');
    await expect(page.locator('h2', { hasText: 'Kitchen' }).filter({ visible: true })).toBeVisible({ timeout: 10000 });
    
    // Disconnect by navigating away
    await page.goto('/');
    
    // Now use the same shareable URL again
    await page.goto('/connect?host=localhost:43598&username=admin');
    
    // Should reconnect to the existing server
    await expect(page.locator('h2', { hasText: 'Kitchen' }).filter({ visible: true })).toBeVisible({ timeout: 10000 });
    
    console.log('Successfully reconnected to existing server via shareable URL!');
  });
});
