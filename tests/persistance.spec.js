const { test, expect } = require('@playwright/test');
const { seed, dbState, switchProfile, today } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };

test.describe('Persistance & isolation', () => {

  test('les données survivent au rechargement', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: [{ id: 'h1', date: today(), dayId: 'd1', dayName: 'A', exercises: [], totalSets: 2, volume: 500, note: '' }],
      prs: { 'développé couché': { name: 'Développé couché', weight: 60, reps: 8, assisted: 0, date: today() } }
    });
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');

    const s = await dbState(page);
    expect(s.programme).toBe(1);
    expect(s.history).toBe(1);
    expect(s.prs).toBe(1);
    expect(s.currentUser).toBe('Mouataz');
  });

  test('aucune clé orpheline (pas de traces)', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    const s = await dbState(page);
    expect(s.keys).toEqual(['at_lastUser', 'at_profiles', 'at_tab', 'at_v2_Mouataz', 'at_v2_Mouataz_t']);
  });

  test('les deux profils restent isolés', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');

    // passage sur Riad sans effacer les données de Mouataz
    await page.evaluate(() => localStorage.setItem('at_lastUser', 'Riad'));
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    expect((await dbState(page)).programme).toBe(0);
    expect((await dbState(page)).currentUser).toBe('Riad');

    await switchProfile(page, 'Mouataz');
    expect((await dbState(page)).programme).toBe(1);
    expect((await dbState(page)).currentUser).toBe('Mouataz');
  });

  test('les anciennes clés ne sont jamais recréées', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.locator('button:has-text("Share")').first().click();
    await page.click('button:has-text("Close")');
    const s = await dbState(page);
    expect(s.keys.filter(k => /^(userdata_|history_|prs_)/.test(k))).toEqual([]);
  });

  test('les profils par défaut sont Mouataz et Riad', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('#welcomeScreen')).toBeVisible();
    await expect(page.locator('.profile-name')).toHaveCount(2, { timeout: 7000 });
    const names = await page.locator('.profile-name').allTextContents();
    expect(names).toEqual(['Mouataz', 'Riad']);
  });
});
