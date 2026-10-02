const { test, expect } = require('@playwright/test');
const { seed, dbState, today, daysAgo } = require('./helpers');

const dayA = { id: 'd1', name: 'PUSH', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };
const dayB = { id: 'd2', name: 'LEGS', type: 'LEGS', exercises: [{ id: 'e2', name: 'Squat barre' }] };

/* index de la cellule (0 = lundi) pour une date donnée */
function cellIndex(iso){
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

test.describe('Planning hebdomadaire', () => {

  test('assigner un jour du programme à une case', async ({ page }) => {
    await seed(page, { programme: [dayA, dayB] }, 'Mouataz');
    await page.click('button[data-tab="calendrier"]');

    const idx = cellIndex(today());
    await page.locator('#planRow .plan-cell').nth(idx).click();
    await expect(page.locator('#planPickModal')).toHaveClass(/show/);
    await page.locator('#planChoices button:has-text("PUSH")').first().click();

    await expect(page.locator('#planRow .plan-cell').nth(idx)).toHaveClass(/todo/);
    await expect(page.locator('#planRow .plan-cell .nm').nth(idx)).toHaveText('PUSH');
    await expect(page.locator('#planSummary')).toHaveText('0/1 done');

    const st = await page.evaluate(() => {
      const e = planEntry(todayISO());
      return { dayId: e.dayId, status: e.status, keys: Object.keys(DB.weeks) };
    });
    expect(st.dayId).toBe('d1');
    expect(st.status).toBe('todo');
    expect(st.keys.length).toBe(1);
  });

  test('une séance terminée fait basculer la case en « fait »', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: [{ id: 'h1', date: today(), dayId: 'd1', dayName: 'PUSH', exercises: [], totalSets: 5, volume: 500, note: '' }]
    }, 'Mouataz');
    await page.click('button[data-tab="calendrier"]');
    await page.locator('#planRow .plan-cell').nth(cellIndex(today())).click();
    await page.locator('#planChoices button:has-text("PUSH")').first().click();

    await expect(page.locator('#planRow .plan-cell').nth(cellIndex(today()))).toHaveClass(/done/);
    await expect(page.locator('#planSummary')).toHaveText('1/1 done');
    expect(await page.evaluate(() => planStatus(todayISO()))).toBe('done');
  });

  test('une case assignée sans séance dans le passé est « ratée »', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    const iso = daysAgo(3);
    await page.evaluate(d => setPlanEntry(d, { dayId: 'd1', status: 'todo' }), iso);
    expect(await page.evaluate(d => planStatus(d), iso)).toBe('missed');
    await page.click('button[data-tab="calendrier"]');
    const cell = page.locator('#planRow .plan-cell', { has: page.locator('.nm', { hasText: 'PUSH' }) });
    if (await cell.count()) await expect(cell).toHaveClass(/missed/);
  });

  test('le Repos exclut la case du résumé', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.click('button[data-tab="calendrier"]');
    const idx = cellIndex(today());
    await page.locator('#planRow .plan-cell').nth(idx).click();
    await page.locator('#planChoices button:has-text("Rest")').click();

    await expect(page.locator('#planRow .plan-cell').nth(idx)).toHaveClass(/skip/);
    await expect(page.locator('#planRow .plan-cell .nm').nth(idx)).toHaveText('Rest');
    await expect(page.locator('#planSummary')).toHaveText('Nothing planned');
  });

  test('vider la case efface l\'entrée', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.click('button[data-tab="calendrier"]');
    const idx = cellIndex(today());
    await page.locator('#planRow .plan-cell').nth(idx).click();
    await page.locator('#planChoices button:has-text("PUSH")').first().click();
    await expect(page.locator('#planRow .plan-cell').nth(idx)).toHaveClass(/todo/);

    await page.locator('#planRow .plan-cell').nth(idx).click();
    await expect(page.locator('#planClearBtn')).toBeVisible();
    await page.locator('#planClearBtn').click();

    await expect(page.locator('#planRow .plan-cell').nth(idx)).toHaveClass(/none/);
    expect(await page.evaluate(() => planEntry(todayISO()))).toBeNull();
  });

  test('le plan et la note de semaine survivent au rechargement', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.click('button[data-tab="calendrier"]');
    await page.locator('#planRow .plan-cell').nth(cellIndex(today())).click();
    await page.locator('#planChoices button:has-text("PUSH")').first().click();
    await page.locator('#weekNote').fill('Bonne énergie, suite au programme.');

    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await page.click('button[data-tab="calendrier"]');

    await expect(page.locator('#planRow .plan-cell').nth(cellIndex(today()))).toHaveClass(/todo/);
    await expect(page.locator('#weekNote')).toHaveValue('Bonne énergie, suite au programme.');
    expect(await page.evaluate(() => planEntry(todayISO()).dayId)).toBe('d1');
  });

  test('la cellule « aujourd\'hui » est marquée', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.click('button[data-tab="calendrier"]');
    await expect(page.locator('#planRow .plan-cell.today')).toHaveCount(1);
    const expected = new Date().toLocaleDateString('en-US', { weekday:'short', day:'numeric', month:'short' });
    expect(await page.locator('#planRow .plan-cell.today').getAttribute('title')).toBe(expected);
  });

  test('sans programme, le sélecteur propose de créer un jour', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.click('button[data-tab="calendrier"]');
    await page.locator('#planRow .plan-cell').nth(cellIndex(today())).click();
    await expect(page.locator('#planChoices')).toContainText('No day in your program');
    await page.locator('#planPickModal button:has-text("Close")').click();
    await expect(page.locator('#planPickModal')).not.toHaveClass(/show/);
  });
});
