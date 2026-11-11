const { test, expect } = require('@playwright/test');
const { seed, dbState } = require('./helpers');

test.describe('Hors-ligne (service worker)', () => {

  test('installation du SW puis rechargement hors ligne', async ({ page, context }) => {
    await seed(page, {}, 'Mouataz');

    await page.evaluate(() => navigator.serviceWorker.ready);
    // 1er rechargement : la page devient contrôlée par le SW (indépendant du claim)
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const cache = await caches.open(keys.find(k => k.startsWith('liftr')) || keys[0]);
      return (await cache.keys()).map(r => r.url);
    });
    expect(cached.some(u => u.includes('index.html'))).toBeTruthy();
    expect(cached.some(u => u.includes('/js/today.js'))).toBeTruthy();

    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveTitle(/Liftr/);
    await expect(page.locator('#mainApp')).toBeVisible();

    // données toujours là hors ligne
    const s = await dbState(page);
    expect(s.currentUser).toBe('Mouataz');

    await context.setOffline(false);
  });

  test('le SW ne casse pas les écritures', async ({ page, context }) => {
    await seed(page, {}, 'Mouataz');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#mainApp')).toBeVisible();
    await context.setOffline(false);
    const s = await dbState(page);
    expect(s.keys).toEqual(['at_lastUser', 'at_profiles', 'at_tab', 'at_v2_Mouataz', 'at_v2_Mouataz_t']);
  });
});
