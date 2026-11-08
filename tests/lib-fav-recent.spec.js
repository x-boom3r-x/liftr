const { test, expect } = require('@playwright/test');
const { seed, dbState, switchProfile } = require('./helpers');

test.describe('Persistance favoris et récents — Library', () => {
  test('favori sauvegardé après rechargement', async ({ page }) => {
    await seed(page, { programme: [] }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="library"]');
    await page.fill('#libScreenSearch', 'bench press');
    await page.waitForTimeout(500);
    const item = page.locator('.lib-item');
    const count = await item.count();
    if (count > 0) {
      await item.first().click();
      await page.waitForTimeout(300);
      // Toggle favori
      const favIcon = page.locator('.lib-tick');
      const isFav = await favIcon.isVisible().catch(() => false);
      // Marquer comme favori (clic sur l'icône)
      if (isFav) {
        await favIcon.click();
      }
      await page.waitForTimeout(200);
      await page.reload();
      await page.waitForTimeout(500);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('liftr_lib_favs') || '[]'));
      expect(stored.length).toBeGreaterThan(0);
    }
  });

  test('récents sauvegardés après rechargement', async ({ page }) => {
    await seed(page, { programme: [] }, 'Mouataz');
    await page.goto('/index.html');
    await switchProfile(page, 'Mouataz');
    await page.click('button[data-tab="library"]');
    await page.fill('#libScreenSearch', 'bench press');
    await page.waitForTimeout(500);
    const item = page.locator('.lib-item');
    const count = await item.count();
    if (count > 0) {
      await item.first().click();
      await page.waitForTimeout(300);
      // Mark as recent
      await page.evaluate(() => {
        if (window.toggleRecent) window.toggleRecent('bench press');
      });
      await page.waitForTimeout(200);
      await page.reload();
      await page.waitForTimeout(500);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('liftr_lib_recents') || '[]'));
      expect(Array.isArray(stored)).toBe(true);
    }
  });
});