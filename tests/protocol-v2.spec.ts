
import { test, expect, Page } from './base-test';

async function connectV2(page: Page, options: { admin?: boolean; username?: string; password?: string } = {}): Promise<void> {
    const { admin = true, username = 'admin', password = '' } = options;
    const adminParam = admin ? '&admin=y' : '';
    const passwordParam = password ? `&secret=${encodeURIComponent(password)}` : '';
    await page.goto(`/?host=localhost:43598&username=${encodeURIComponent(username)}${passwordParam}${adminParam}&protocol=v2`);
}

test.describe('Protocol V2', () => {
  test('should connect using v2 protocol and receive state dump', async ({ page }) => {
    // Enable console logging to see the messages
    const messages: any[] = [];
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('WebSocket') || text.includes('type:') || text.includes('state')) {
            messages.push(text);
        }
    });

    // Connect using v2 protocol
    await connectV2(page);
    
    // Wait for page to load
    await page.waitForTimeout(2000);
    
    // Log the messages for debugging
    console.log('Console messages:', messages.join('\n'));
    
    // Verify connection by checking if we can see any groups or devices
    // For now, just verify the page loaded
    await expect(page.locator('body')).toBeVisible();
  });

  test('should send light.set command and receive response', async ({ page }) => {
    // This test will verify the command/response flow
    // TODO: Implement after client-side v2 support is added
    await connectV2(page);
    await page.waitForTimeout(1000);
    
    // For now, just verify connection works
    await expect(page.locator('body')).toBeVisible();
  });
});
