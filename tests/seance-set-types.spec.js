const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const day = {
  id: 'dropset-day', name: 'Drop day', type: 'UPPER',
  exercises: [{ id: 'bench', name: 'Bench Press' }]
};

test('un dropset modifiable est gardé dans l’historique et ajouté au volume sans changer le record principal', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await seed(page, { programme: [day] });
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();

  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await page.locator('#weightInput').fill('100');
  await page.locator('#repsInput').fill('8');
  await page.locator('#addSetModal button:has-text("Save set")').click();

  await page.locator('.set-additions:not(.set-bursts) .set-addition-add').click();
  const drop = page.locator('#activeExercises .set-addition-row').first();
  await expect(drop).toContainText('Drop 1');
  await expect(drop).toContainText('80 kg × 8');
  await drop.locator('[aria-label="Increase drop weight"]').click();
  await drop.locator('[aria-label="Increase drop reps"]').click();
  await expect(drop).toContainText('80.5 kg × 9');

  const active = await page.evaluate(() => ({
    set: DB.active.exercises[0].sets[0],
    volume: volumeOf(DB.active.exercises[0].sets[0])
  }));
  expect(active.set).toMatchObject({ weight: 100, reps: 8, drops: [{ weight: 80.5, reps: 9 }] });
  expect(active.volume).toBe(1524.5);

  await page.locator('#activeModal button:has-text("Finish session")').click();
  const history = await page.evaluate(() => ({
    workout: DB.history[0],
    pr: DB.prs['bench press'],
    short: setShort(DB.history[0].exercises[0].sets[0])
  }));
  expect(history.workout).toMatchObject({ totalSets: 1, workingSets: 1, volume: 1525 });
  expect(history.pr).toMatchObject({ weight: 100, reps: 8 });
  expect(history.short).toContain('[drop 1: 80.5kg×9]');
  await page.evaluate(() => openSessionDetail(DB.history[0].id));
  await expect(page.locator('#daySheetContent')).toContainText('DROP 1');
  await expect(page.locator('#daySheetContent')).toContainText('80.5 kg × 9');
});

test('les clusters rest-pause sont éditables, persistants et comptés sans gonfler le record de force', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await seed(page, { programme: [day] });
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();

  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await page.locator('#weightInput').fill('80');
  await page.locator('#repsInput').fill('10');
  await page.locator('#addSetModal button:has-text("Save set")').click();

  await page.locator('.set-bursts .set-addition-add').click();
  const burst = page.locator('.set-bursts .set-addition-row').first();
  await expect(burst).toContainText('Burst 1');
  await expect(burst).toContainText('+5 reps · 15 s rest');
  await burst.locator('[aria-label="Increase burst reps"]').click();
  await burst.locator('[aria-label="Increase burst rest"]').click();
  await expect(burst).toContainText('+6 reps · 20 s rest');

  const active = await page.evaluate(() => ({
    set: DB.active.exercises[0].sets[0],
    volume: volumeOf(DB.active.exercises[0].sets[0]),
    summary: setShort(DB.active.exercises[0].sets[0])
  }));
  expect(active.set).toMatchObject({ weight: 80, reps: 10, restPause: { clusters: [{ reps: 6, restSec: 20 }] } });
  expect(active.volume).toBe(1280);
  expect(active.summary).toContain('[rest-pause 1: +6 reps / 20s]');

  await page.reload();
  await page.waitForSelector('#mainApp:not(.hidden)');
  await page.locator('.sess-banner button:has-text("Resume")').click();
  await expect(page.locator('.set-bursts .set-addition-row')).toContainText('+6 reps · 20 s rest');
  await page.locator('#activeModal button:has-text("Finish session")').click();

  const saved = await page.evaluate(() => ({
    workout: DB.history[0],
    pr: DB.prs['bench press'],
    set: DB.history[0].exercises[0].sets[0],
    summary: setShort(DB.history[0].exercises[0].sets[0])
  }));
  expect(saved.workout).toMatchObject({ totalSets: 1, workingSets: 1, volume: 1280 });
  expect(saved.pr).toMatchObject({ weight: 80, reps: 10 });
  expect(saved.set.restPause.clusters).toEqual([{ reps: 6, restSec: 20 }]);
  expect(saved.summary).toContain('[rest-pause 1: +6 reps / 20s]');
  await page.evaluate(() => openSessionDetail(DB.history[0].id));
  await expect(page.locator('#daySheetContent')).toContainText('RP 1');
  await expect(page.locator('#daySheetContent')).toContainText('+6 reps');
});
