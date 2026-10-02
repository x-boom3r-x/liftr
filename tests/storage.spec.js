const { test, expect } = require('@playwright/test');
const { seed, dbState, today } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };
const hist = [{ id: 'h1', date: today(), dayId: 'd1', dayName: 'A', exercises: [], totalSets: 2, volume: 500, note: '' }];

async function waitForIdb(page, name){
  await page.waitForFunction(async n => (await window.idbGetProfile(n)) !== null, name, { timeout: 7000 });
}

test.describe('IndexedDB', () => {

  test('le profil est écrit dans IndexedDB', async ({ page }) => {
    await seed(page, { programme: [dayA], history: hist }, 'Mouataz');
    await waitForIdb(page, 'Mouataz');
    const rec = await page.evaluate(() => window.idbGetProfile('Mouataz'));
    expect(rec.programme.length).toBe(1);
    expect(rec.history.length).toBe(1);
  });

  test('les données survivent à une éviction de localStorage', async ({ page }) => {
    await seed(page, { programme: [dayA], history: hist }, 'Mouataz');
    await waitForIdb(page, 'Mouataz');

    // le navigateur vide le localStorage (quota / éviction) : l'app doit se relever via IDB
    await page.evaluate(() => localStorage.removeItem('at_v2_Mouataz'));
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');

    expect(await page.evaluate(() => DB.programme.length)).toBe(1);
    expect(await page.evaluate(() => DB.history.length)).toBe(1);
    expect((await dbState(page)).programme).toBe(1); // miroir restauré
  });

  test('migration localStorage → IndexedDB au premier chargement', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(db => {
      localStorage.clear();
      localStorage.setItem('at_profiles', JSON.stringify(['Mouataz', 'Riad']));
      localStorage.setItem('at_lastUser', 'Mouataz');
      localStorage.setItem('at_v2_Mouataz', JSON.stringify(db));
    }, { programme: [dayA], history: hist, progressions: [], weeks: {}, prs: {}, custom: [], active: null });

    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await waitForIdb(page, 'Mouataz');

    const rec = await page.evaluate(() => window.idbGetProfile('Mouataz'));
    expect(rec.programme.length).toBe(1);
    expect(rec.history.length).toBe(1);
    expect((await dbState(page)).programme).toBe(1);
  });

  test('les profils cohabitent dans IndexedDB sans se marcher dessus', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await waitForIdb(page, 'Mouataz');

    // bascule sur Riad (seed ne vide pas l'IndexedDB)
    await seed(page, { programme: [dayA, { id: 'd9', name: 'Z', type: 'LEGS', exercises: [] }] }, 'Riad');
    await waitForIdb(page, 'Riad');

    const both = await page.evaluate(async () => ({
      mouataz: (await window.idbGetProfile('Mouataz')).programme.length,
      riad: (await window.idbGetProfile('Riad')).programme.length
    }));
    expect(both.mouataz).toBe(1);
    expect(both.riad).toBe(2);

    await page.evaluate(() => localStorage.setItem('at_lastUser', 'Mouataz'));
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    expect((await dbState(page)).programme).toBe(1);
    expect(await page.evaluate(() => currentUser)).toBe('Mouataz');
  });
});
