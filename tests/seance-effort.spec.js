const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const day = {
  id: 'effort-day', name: 'Effort day', type: 'UPPER',
  exercises: [{ id: 'bench', name: 'Bench Press' }]
};

async function startSession(page){
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();
  await expect(page.locator('#activeModal')).toHaveClass(/show/);
}

async function openSet(page){
  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await expect(page.locator('#addSetModal')).toHaveClass(/show/);
}

test.describe('Effort et types de série dans la séance guidée', () => {
  test('enregistre RIR et RPE séparément, puis les retrouve après rechargement', async ({ page }) => {
    await seed(page, { programme: [day] });
    await startSession(page);

    await openSet(page);
    await page.locator('#effortInput').fill('2.5');
    await page.locator('#addSetModal button:has-text("Save set")').click();

    await openSet(page);
    await page.locator('#effortScale').selectOption('rpe');
    await page.locator('#effortInput').fill('8.5');
    await page.locator('#addSetModal button:has-text("Save set")').click();

    await expect(page.locator('#activeExercises .set-values').nth(0)).toContainText('RIR 2.5');
    await expect(page.locator('#activeExercises .set-values').nth(1)).toContainText('RPE 8.5');
    await page.reload();
    await expect(page.locator('.sess-banner')).toBeVisible();
    await page.locator('.sess-banner button:has-text("Resume")').click();
    await expect(page.locator('#activeExercises .set-values').nth(0)).toContainText('RIR 2.5');
    await expect(page.locator('#activeExercises .set-values').nth(1)).toContainText('RPE 8.5');

    page.on('dialog', dialog => dialog.accept());
    await page.locator('#activeModal button:has-text("Finish session")').click();
    const saved = await page.evaluate(() => ({
      sets: DB.history[0].exercises[0].sets,
      short: DB.history[0].exercises[0].sets.map(setShort)
    }));
    expect(saved.sets[0]).toMatchObject({ rir: 2.5 });
    expect(saved.sets[1]).toMatchObject({ rpe: 8.5 });
    expect(saved.short[0]).toContain('[RIR 2.5]');
    expect(saved.short[1]).toContain('[RPE 8.5]');
    await page.evaluate(() => openSessionDetail(DB.history[0].id));
    await expect(page.locator('#daySheetContent')).toContainText('RIR 2.5');
    await expect(page.locator('#daySheetContent')).toContainText('RPE 8.5');
  });

  test('garde les échauffements en historique sans les compter dans le volume ou les records', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await seed(page, { programme: [day] });
    await startSession(page);

    await openSet(page);
    await page.locator('#weightInput').fill('100');
    await page.locator('#repsInput').fill('10');
    await page.locator('#warmupInput').check();
    await expect(page.locator('#strengthEffortField')).toBeHidden();
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await expect(page.locator('#sessRecap .recap-score')).toHaveText('0/1 done');

    await openSet(page);
    await page.locator('#weightInput').fill('40');
    await page.locator('#repsInput').fill('5');
    await page.locator('#failureInput').check();
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await expect(page.locator('#activeExercises .set-values').nth(0)).toContainText('WARM-UP');
    await expect(page.locator('#activeExercises .set-values').nth(1)).toContainText('FAILURE');

    await page.locator('#activeModal button:has-text("Finish session")').click();
    const saved = await page.evaluate(() => ({
      history: DB.history[0],
      pr: DB.prs['bench press'],
      activeVolume: volumeOf({ weight: 100, reps: 10, phase: 'warmup' })
    }));
    expect(saved.history).toMatchObject({ totalSets: 2, workingSets: 1, volume: 200 });
    expect(saved.history.exercises[0].sets[0]).toMatchObject({ phase: 'warmup' });
    expect(saved.history.exercises[0].sets[1]).toMatchObject({ failure: true });
    expect(saved.pr).toMatchObject({ weight: 40, reps: 5 });
    expect(saved.activeVolume).toBe(0);
    await page.evaluate(() => openSessionDetail(DB.history[0].id));
    await expect(page.locator('#daySheetContent')).toContainText('WARM-UP');
    await expect(page.locator('#daySheetContent')).toContainText('FAILURE');
  });

  test('refuse une note RPE hors de la plage prise en charge', async ({ page }) => {
    await seed(page, { programme: [day] });
    await startSession(page);
    await openSet(page);
    await page.locator('#effortScale').selectOption('rpe');
    await page.locator('#effortInput').fill('5');
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await expect(page.locator('#addSetModal')).toHaveClass(/show/);
    await expect(page.locator('.toast')).toContainText('RPE must be between 6 and 10');
    expect(await page.evaluate(() => DB.active.exercises[0].sets)).toEqual([]);
  });
});
