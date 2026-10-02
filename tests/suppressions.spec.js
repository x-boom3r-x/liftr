const { test, expect } = require('@playwright/test');
const { seed, dbState, today } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };

function twoSessions(){
  return [
    { id: 'h1', date: today(), dayId: 'd1', dayName: 'A', exercises: [], totalSets: 2, volume: 500, note: '' },
    { id: 'h2', date: today(), dayId: 'd1', dayName: 'A', exercises: [], totalSets: 3, volume: 700, note: '' }
  ];
}

test.describe('Suppressions', () => {

  test('supprimer UNE séance laisse les autres et le jour', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: twoSessions(),
      prs: { 'développé couché': { name: 'Développé couché', weight: 60, reps: 8, assisted: 0, date: today() } }
    });

    await page.click('button[data-tab="stats"]');
    await expect(page.locator('#statsContent .hist-item')).toHaveCount(2);

    await page.locator('#statsContent .hist-del').first().click();
    await expect(page.locator('#confirmModal')).toHaveClass(/show/);
    await page.click('#cfOk');

    await expect(page.locator('#statsContent .hist-item')).toHaveCount(1);
    const s = await dbState(page);
    expect(s.history).toBe(1);
    expect(s.programme).toBe(1);
    expect(s.prs).toBe(1);
    await expect(page.locator('.vol-value')).toContainText('700');
  });

  test('le clic sur le corps de la ligne ouvre le détail (et non la suppression)', async ({ page }) => {
    await seed(page, { programme: [dayA], history: twoSessions() });
    await page.click('button[data-tab="stats"]');
    await page.locator('#statsContent .hist-item').first().click();
    await expect(page.locator('#daySheetModal')).toHaveClass(/show/);
    expect((await dbState(page)).history).toBe(2);
    await page.click('#daySheetDelete');
    await expect(page.locator('#confirmModal')).toHaveClass(/show/);
    await page.click('#cfOk');
    expect((await dbState(page)).history).toBe(1);
  });

  test('supprimer un jour purge stats, records et calendrier (case décochée par défaut)', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: twoSessions(),
      prs: { 'développé couché': { name: 'Développé couché', weight: 60, reps: 8, assisted: 0, date: today() } }
    });

    await page.click('button[data-tab="programme"]');
    await page.locator('#daysList [title="Delete"]').first().click();
    await expect(page.locator('#confirmModal')).toHaveClass(/show/);
    await expect(page.locator('#cfCheck')).not.toBeChecked();

    await page.click('#cfOk');

    const s = await dbState(page);
    expect(s.programme).toBe(0);
    expect(s.history).toBe(0);
    expect(s.prs).toBe(0);

    await page.click('button[data-tab="stats"]');
    await expect(page.locator('#statsContent')).toContainText('Not enough data yet');
  });

  test('annulation : rien ne change', async ({ page }) => {
    await seed(page, { programme: [dayA], history: twoSessions() });
    await page.click('button[data-tab="programme"]');
    await page.locator('#daysList [title="Delete"]').first().click();
    await page.locator('#confirmModal button:has-text("Cancel")').click();
    const s = await dbState(page);
    expect(s.programme).toBe(1);
    expect(s.history).toBe(2);
  });

  test('« Tout effacer » vide entièrement le profil sans toucher aux autres', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: twoSessions(),
      prs: { 'développé couché': { name: 'Développé couché', weight: 60, reps: 8, assisted: 0, date: today() } },
      custom: ['Exo perso'],
      weeks: { '2026-W40': { note: 'note' } }
    });
    await page.locator('button:has-text("Delete everything")').click();
    await expect(page.locator('#confirmModal')).toHaveClass(/show/);
    await page.click('#cfOk');

    const s = await dbState(page);
    expect(s.programme).toBe(0);
    expect(s.history).toBe(0);
    expect(s.prs).toBe(0);
    expect(s.progressions).toBe(0);
    expect(s.custom).toBe(0);

    const other = await page.evaluate(() => localStorage.getItem('at_v2_Riad'));
    expect(other === null || JSON.parse(other).programme.length === 0).toBeTruthy();
  });
});
