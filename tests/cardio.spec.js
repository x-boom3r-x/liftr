const { test, expect } = require('@playwright/test');
const { seed, dbState, daysAgo, today } = require('./helpers');

const dayCardio = {
  id: 'dc', name: 'CARDIO', type: 'CARDIO',
  exercises: [{ id: 'ec', name: 'Tapis de course', cardio: true }]
};
const dayMix = {
  id: 'dm', name: 'FULL', type: 'FULL',
  exercises: [
    { id: 'e1', name: 'Développé couché' },
    { id: 'ec', name: 'Tapis de course', cardio: true }
  ]
};

async function startSession(page){
  await page.click('button[data-tab="seance"]');
  await page.locator('button:has-text("Start")').first().click();
  await expect(page.locator('#activeModal')).toHaveClass(/show/);
}

test.describe('Cardio (course / vélo)', () => {

  test('un exo cardio affiche le chip CARDIO et le bouton « + Run »', async ({ page }) => {
    await seed(page, { programme: [dayCardio] }, 'Mouataz');
    await startSession(page);

    await expect(page.locator('#activeExercises .ex-name')).toContainText('CARDIO');
    await expect(page.locator('#activeExercises .chip-cardio')).toBeVisible();
    await expect(page.locator('#activeExercises button:has-text("+ Run")')).toBeVisible();
    await expect(page.locator('#activeExercises button:has-text("+ Set")')).toHaveCount(0);
  });

  test('la saisie cardio masque les champs force et affiche durée/distance', async ({ page }) => {
    await seed(page, { programme: [dayCardio] }, 'Mouataz');
    await startSession(page);
    await page.locator('#activeExercises button:has-text("+ Run")').first().click();

    await expect(page.locator('#addSetModal')).toHaveClass(/show/);
    await expect(page.locator('#addSetTitle')).toContainText('Run · Tapis de course');
    await expect(page.locator('#cardioFields')).toBeVisible();
    await expect(page.locator('#strengthFields')).toBeHidden();
    await expect(page.locator('#addSetModal button:has-text("Save run")')).toBeVisible();
    await expect(page.locator('#cardioMinInput')).toHaveValue('30');
    await expect(page.locator('#cardioKmInput')).toHaveValue('5');
  });

  test('terminer une séance cardio écrit cardioMin/cardioKm sans PR', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, {
      programme: [dayCardio],
      prs: { 'tapis de course': { name: 'Tapis de course', weight: 100, reps: 1, assisted: 0, date: daysAgo(10) } }
    }, 'Mouataz');
    await startSession(page);
    await page.locator('#activeExercises button:has-text("+ Run")').first().click();
    await page.locator('#addSetModal button:has-text("+")').last().click(); /* +1 km */
    await page.locator('#addSetModal button:has-text("Save run")').click();

    const activeSets = await page.evaluate(() => DB.active.exercises[0].sets);
    expect(activeSets).toEqual([{ cardio: true, min: 30, km: 6 }]);

    await page.locator('#activeModal button:has-text("Finish session")').click();
    await expect(page.locator('#activeModal')).not.toHaveClass(/show/);

    const h = await page.evaluate(() => DB.history[0]);
    expect(h.cardioMin).toBe(30);
    expect(h.cardioKm).toBe(6);
    expect(h.volume).toBe(0);
    expect(h.totalSets).toBe(1);
    expect(h.exercises[0].sets[0].cardio).toBe(true);

    const s = await dbState(page);
    expect(s.history).toBe(1);
    expect(s.prs).toBe(1); /* record existant intact, aucun PR créé */
    expect(await page.evaluate(() => DB.prs['tapis de course'].weight)).toBe(100);
  });

  test('un jour mixte enregistre force + cardio dans la même séance', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayMix] }, 'Mouataz');
    await startSession(page);

    await page.locator('#activeExercises button:has-text("+ Set")').first().click();
    await page.locator('#addSetModal button:has-text("Save set")').click();

    await page.locator('#activeExercises button:has-text("+ Run")').last().click();
    await page.locator('#addSetModal button:has-text("Save run")').click();

    await page.locator('#activeModal button:has-text("Finish session")').click();

    const h = await page.evaluate(() => DB.history[0]);
    expect(h.exercises.length).toBe(2);
    expect(h.volume).toBeGreaterThan(0);
    expect(h.cardioKm).toBe(5);
    expect(h.cardioMin).toBe(30);
  });

  test('volumeOf(0) et setShort gèrent la ligne cardio', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const r = await page.evaluate(() => ({
      vol: volumeOf({ cardio: true, min: 30, km: 5 }),
      short: setShort({ cardio: true, min: 30, km: 5 }),
      shortStr: setShort({ weight: 60, reps: 8, assisted: 2 }),
      line: setLine({ cardio: true, min: 45, km: 10 })
    }));
    expect(r.vol).toBe(0);
    expect(r.short).toBe('30 min · 5 km');
    expect(r.shortStr).toBe('60kg×8+2A');
    expect(r.line).toContain('min');
    expect(r.line).toContain('km');
    expect(Number.isNaN(r.vol)).toBe(false);
  });

  test('les stats affichent la carte cardio cumulée', async ({ page }) => {
    await seed(page, {
      history: [{
        id: 'h1', date: daysAgo(1), dayId: 'dc', dayName: 'CARDIO', note: '',
        exercises: [{ id: 'ec', name: 'Tapis de course', cardio: true, sets: [{ cardio: true, min: 30, km: 5 }] }],
        totalSets: 1, volume: 0, performed: 1, cardioMin: 30, cardioKm: 5
      }]
    }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    const card = page.locator('#statsContent .cardio-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('5');
    await expect(card).toContainText('minutes');
    await expect(card).toContainText('runs');
    await expect(page.locator('#statsContent .hist-ex').first()).toContainText('30 min · 5 km');
  });

  test('aucune erreur console avec du cardio (4 onglets)', async ({ page }) => {
    const errs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await seed(page, {
      programme: [dayMix],
      history: [{
        id: 'h1', date: today(), dayId: 'dm', dayName: 'FULL', note: '',
        exercises: [{ id: 'ec', name: 'Tapis de course', cardio: true, sets: [{ cardio: true, min: 30, km: 5 }] }],
        totalSets: 1, volume: 0, performed: 1, cardioMin: 30, cardioKm: 5
      }]
    }, 'Mouataz');
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    for (const t of ['programme', 'seance', 'calendrier', 'stats']){
      await page.click(`button[data-tab="${t}"]`);
      await page.waitForTimeout(120);
    }
    expect(errs).toEqual([]);
  });
});
