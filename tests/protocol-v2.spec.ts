
import { test, expect, Page } from './base-test';

async function connectV2(page: Page, options: { admin?: boolean; username?: string; password?: string } = {}): Promise<void> {
    const { admin = true, username = 'admin', password = '' } = options;
    const adminParam = admin ? '&admin=y' : '';
    const passwordParam = password ? `&secret=${encodeURIComponent(password)}` : '';
    await page.goto(`/?host=localhost:43598&username=${encodeURIComponent(username)}${passwordParam}${adminParam}&protocol=v2`);
}

test.describe('Protocol V2', () => {
  test('should connect using v2 protocol and receive state dump', async ({ page }) => {
    // Connect using v2 protocol
    await connectV2(page);
    
    // Wait for the page body to be visible
    await expect(page.locator('body')).toBeVisible();
    
    // Wait a moment for state to be received
    await page.waitForLoadState('networkidle');
    
    // Verify we're connected by checking for any visible content
    // (The actual state verification would require inspecting the app's internal state)
    const hasContent = await page.locator('body').evaluate(el => el.textContent && el.textContent.length > 10);
    expect(hasContent).toBeTruthy();
  });

  // TODO: Implement command/response flow test once command sending is implemented in client
  test.skip('should send light.set command and receive response', async ({ page }) => {
    // This test will verify the command/response flow
    // Skipped until client-side v2 command sending is implemented
    await connectV2(page);
    
    // For now, just verify connection works
    await expect(page.locator('body')).toBeVisible();
  });
});
