const { test, expect } = require('@playwright/test');
const { seed, dbState, daysAgo } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };

const hist = {
  id: 'h1', date: daysAgo(3), dayId: 'd1', dayName: 'A',
  exercises: [{ id: 'e1', name: 'Développé couché', sets: [
    { weight: 60, reps: 8, assisted: 0 },
    { weight: 60, reps: 9, assisted: 0 }
  ] }],
  totalSets: 2, volume: 60 * 8 + 60 * 9, note: ''
};

const prs = { 'développé couché': { name: 'Développé couché', weight: 65, reps: 5, assisted: 0, date: daysAgo(10) } };

async function startSession(page){
  await page.click('button[data-tab="seance"]');
  await page.locator('button:has-text("Start")').first().click();
  await expect(page.locator('#activeModal')).toHaveClass(/show/);
}

async function addSet(page){
  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await expect(page.locator('#addSetModal')).toHaveClass(/show/);
  await page.locator('#addSetModal button:has-text("Save set")').click();
}

test.describe('Séance en cours', () => {

  test('ajouter une série lance le timer de repos (90 s)', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await startSession(page);
    await addSet(page);

    await expect(page.locator('#restTime')).toHaveText('1:30');
    await expect(page.locator('#restStartBtn')).toBeHidden();
    await expect(page.locator('#restRunning')).toBeVisible();

    const st = await page.evaluate(() => ({ until: DB.active.restUntil, secs: DB.active.restSecs, done: DB.active.restDone }));
    expect(st.until).toBeGreaterThan(Date.now());
    expect(st.secs).toBe(90);
    expect(st.done).toBe(false);
  });

  test('+15 s / Passer pilotent le timer', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await startSession(page);
    await addSet(page);

    await page.locator('#restRunning button:has-text("+15")').click();
    await expect(page.locator('#restTime')).toHaveText(/^1:4[0-5]$/);
    expect(await page.evaluate(() => DB.active.restSecs)).toBe(105);

    await page.locator('#restRunning button:has-text("−15")').click();
    await expect(page.locator('#restTime')).toHaveText(/^1:(29|3[0-9])$/);

    await page.locator('#restRunning button:has-text("Skip")').click();
    await expect(page.locator('#restTime')).toHaveText('Ready!');
    await expect(page.locator('#restBar')).toHaveClass(/done/);
    expect(await page.evaluate(() => DB.active.restDone)).toBe(true);
  });

  test('le timer survit à un rechargement', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await startSession(page);
    await addSet(page);

    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await expect(page.locator('.sess-banner')).toBeVisible();
    await page.locator('.sess-banner button:has-text("Resume")').click();

    await expect(page.locator('#restBar')).toBeVisible();
    await expect(page.locator('#restTime')).toHaveText(/^\d+:[0-5]\d$/);
    expect(await page.evaluate(() => DB.active.exercises[0].sets.length)).toBe(1);
  });

  test('le lancement manuel à 90 s fonctionne', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await startSession(page);

    await page.locator('#restStartBtn').click();
    await expect(page.locator('#restTime')).toHaveText('1:30');
    expect(await page.evaluate(() => DB.active.restUntil)).toBeGreaterThan(Date.now());
  });

  test('suggestion : +2,5 kg après 8+ reps, cliquable', async ({ page }) => {
    await seed(page, { programme: [dayA], history: [hist] }, 'Mouataz');
    await startSession(page);
    await page.locator('#activeExercises button:has-text("+ Set")').first().click();

    await expect(page.locator('#setContext')).toBeVisible();
    await expect(page.locator('.ctx-row').first()).toContainText('Last time');
    await expect(page.locator('.ctx-row').first()).toContainText('60×8, 60×9');
    await expect(page.locator('.ctx-sug')).toContainText('62.5 kg × 8');

    await page.locator('.ctx-sug').click();
    await expect(page.locator('#weightInput')).toHaveValue('62.5');
    await expect(page.locator('#repsInput')).toHaveValue('8');

    await page.locator('#addSetModal button:has-text("Save set")').click();
    expect(await page.evaluate(() => DB.active.exercises[0].sets[0])).toEqual({ weight: 62.5, reps: 8, assisted: 0 });
  });

  test('sans historique : ni suggestion ni contexte', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await startSession(page);
    await page.locator('#activeExercises button:has-text("+ Set")').first().click();
    await expect(page.locator('#setContext')).toBeHidden();
  });

  test("historique de l'exercice affiché dans la séance (dernière fois, PR, e1RM)", async ({ page }) => {
    await seed(page, { programme: [dayA], history: [hist], prs }, 'Mouataz');
    await startSession(page);

    const ctx = page.locator('#activeExercises .ex-ctx').first();
    await expect(ctx).toBeVisible();
    await expect(ctx).toContainText('Last time');
    await expect(ctx).toContainText('60×8, 60×9');
    await expect(ctx).toContainText('PR 65×5');
    await expect(ctx).toContainText('e1RM');
  });

  test('terminer la séance écrit l’historique et le record', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await startSession(page);
    await addSet(page);

    await page.locator('#activeModal button:has-text("Finish session")').click();

    await expect(page.locator('#activeModal')).not.toHaveClass(/show/);
    const s = await dbState(page);
    expect(s.history).toBe(1);
    expect(s.prs).toBe(1);
    expect(s.active).toBe(false);
    expect(await page.evaluate(() => DB.history[0].exercises[0].sets.length)).toBe(1);
  });
});
