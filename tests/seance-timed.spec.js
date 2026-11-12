const { test, expect } = require('@playwright/test');
const { seed, daysAgo } = require('./helpers');

const program = { id: 'timed-program', name: 'Timed block', active: true };
const day = {
  id: 'timed-day', name: 'Core', type: 'CORE', programId: 'timed-program',
  exercises: [{ id: 'plank', name: 'Plank', sets: 2, seconds: 20 }]
};
const day30 = { ...day, exercises: [{ ...day.exercises[0], seconds: 30 }] };

async function startSession(page){
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();
  await expect(page.locator('#activeModal')).toHaveClass(/show/);
}

test('les maintiens chronométrés enregistrent la durée réelle sans volume ni record de charge', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await seed(page, { programmes: [program], programme: [day] });
  await startSession(page);

  await page.locator('#activeExercises button:has-text("+ Hold")').click();
  await expect(page.locator('#timeFields')).toBeVisible();
  await expect(page.locator('#strengthFields')).toBeHidden();
  await expect(page.locator('#holdSecondsInput')).toHaveValue('20');
  await expect(page.locator('#warmupFlagRow')).toBeVisible();

  await page.locator('#warmupInput').check();
  await page.locator('#startHoldBtn').click();
  await expect(page.locator('#holdTimerControls')).toBeVisible();
  await page.waitForTimeout(1100);
  await page.reload();
  await page.locator('.sess-banner button:has-text("Resume")').click();
  await expect(page.locator('#holdTimerControls')).toBeVisible();
  await page.locator('#finishHoldBtn').click();

  const warmup = await page.evaluate(() => DB.active.exercises[0].sets[0]);
  expect(warmup).toMatchObject({ timed: true, phase: 'warmup' });
  expect(warmup.sec).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => volumeOf(DB.active.exercises[0].sets[0]))).toBe(0);
  await expect(page.locator('#activeExercises .set-values').first()).toContainText('s hold');
  await expect(page.locator('#activeExercises .set-values').first()).toContainText('WARM-UP');

  await page.locator('#activeExercises button:has-text("+ Hold")').click();
  await page.locator('#holdSecondsInput').fill('18');
  await page.locator('#saveSetBtn').click();
  await page.locator('#activeModal button:has-text("Finish session")').click();

  const history = await page.evaluate(() => DB.history[0]);
  expect(history.volume).toBe(0);
  expect(history.holdSec).toBe(warmup.sec + 18);
  expect(history.workingSets).toBe(1);
  expect(history.exercises[0].sets[1]).toEqual({ timed: true, sec: 18 });
  expect(history.plannedExercises[0].planned).toMatchObject({ mode: 'time', sec: 20, sets: 2, progression: 'time' });
  expect(await page.evaluate(() => Object.keys(DB.prs).length)).toBe(0);

  await page.evaluate(() => openSessionDetail(DB.history[0].id));
  await expect(page.locator('#daySheetContent')).toContainText('20 s hold');
  await expect(page.locator('#daySheetContent')).toContainText('18 s hold');
});

test('la progression chronométrée ajoute cinq secondes quand toutes les séries atteignent la cible', async ({ page }) => {
  const previous = {
    id: 'timed-history', date: daysAgo(1), dayId: day.id, dayName: day.name,
    exercises: [{ id: 'plank', name: 'Plank', sets: [{ timed: true, sec: 30 }, { timed: true, sec: 30 }] }],
    plannedExercises: [{ id: 'plank', name: 'Plank', planned: { mode: 'time', sets: 2, sec: 30, progression: 'time' } }]
  };
  await seed(page, { programmes: [program], programme: [day30], history: [previous] });
  await startSession(page);
  await page.locator('#activeExercises button:has-text("+ Hold")').click();
  await expect(page.locator('.ctx-sug')).toContainText('Suggested: 35 s');
  await page.locator('.ctx-sug').click();
  await expect(page.locator('#holdSecondsInput')).toHaveValue('35');
});

test('une séance précédente incomplète conserve la cible chronométrée', async ({ page }) => {
  const previous = {
    id: 'timed-history', date: daysAgo(1), dayId: day.id, dayName: day.name,
    exercises: [{ id: 'plank', name: 'Plank', sets: [{ timed: true, sec: 30 }] }],
    plannedExercises: [{ id: 'plank', name: 'Plank', planned: { mode: 'time', sets: 2, sec: 30, progression: 'time' } }]
  };
  await seed(page, { programmes: [program], programme: [day30], history: [previous] });
  await startSession(page);
  await page.locator('#activeExercises button:has-text("+ Hold")').click();
  await expect(page.locator('.ctx-sug')).toContainText('Suggested: 30 s');
  await expect(page.locator('.ctx-sug')).toContainText('not all planned holds were logged');
});

test('le compte à rebours valide automatiquement un maintien arrivé à sa cible', async ({ page }) => {
  const shortDay = { ...day, exercises: [{ ...day.exercises[0], sets: 1, seconds: 2 }] };
  await seed(page, { programmes: [program], programme: [shortDay] });
  await startSession(page);
  await page.locator('#activeExercises button:has-text("+ Hold")').click();
  await page.locator('#startHoldBtn').click();
  await expect(page.locator('#holdTimerControls')).toBeVisible();
  await expect(page.locator('#activeExercises .set-values')).toContainText('2 s hold', { timeout: 5000 });
  expect(await page.evaluate(() => DB.active.exercises[0].sets[0])).toMatchObject({ timed: true, sec: 2 });
});

test('l’editeur du programme transforme les secondes en cible chronométrée', async ({ page }) => {
  await seed(page, { programmes: [program], programme: [
    { ...day, exercises: [{ id: 'plank', name: 'Plank' }] }
  ] });
  await page.click('button[data-tab="programme"]');
  await page.locator('#daysList [data-day-id="timed-day"] .programme-day-main').click();
  await page.locator('.ex-params summary').click();
  await page.locator('#param-sets-plank').fill('2');
  await page.locator('#param-seconds-plank').fill('30');
  await page.locator('#dayDetailModal button:has-text("Enregistrer les objectifs")').click();

  const params = await page.evaluate(() => DB.programme[0].exercises[0]);
  expect(params).toMatchObject({ sets: 2, seconds: 30, progression: 'time' });
  await page.evaluate(() => startSession('timed-day'));
  expect(await page.evaluate(() => DB.active.exercises[0].planned)).toMatchObject({ mode: 'time', sec: 30, sets: 2, progression: 'time' });
});
