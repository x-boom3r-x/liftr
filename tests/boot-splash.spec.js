const { test, expect } = require('@playwright/test');

test('Liftr shows its branded loading screen until startup is ready', async ({ page }, testInfo) => {
  await page.route('**/js/app.js', async route => {
    await new Promise(resolve => setTimeout(resolve, 1100));
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'commit' });
  const splash = page.locator('#bootSplash');
  await expect(splash).toBeVisible();
  await expect(page.locator('.boot-mark img')).toHaveAttribute('src', 'liftr-icon-512-v109.png');
  await expect(page.locator('#bootStatus')).toHaveText('Preparing your training space');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'liftr-icon-192-v109.png');
  await expect(page.locator('#mainApp .header .logo')).toHaveCount(0);

  await page.waitForFunction(() => {
    const mark = document.querySelector('.boot-mark');
    return mark && getComputedStyle(mark).animationName === 'boot-mark-in';
  });
  await page.screenshot({ path: testInfo.outputPath('liftr-loading.png'), fullPage: true });
  await expect(splash).toBeHidden({ timeout: 10000 });
});

