const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

test('la pyramide préremplit chaque série, ne compte pas les échauffements et conserve la série max', async ({ page }) => {
  const day = {
    id: 'pyramid-day', name: 'Pyramide', type: 'UPPER',
    exercises: [{ id: 'bench', name: 'Bench Press', sets: 3, reps: '12,10,max', weight: 60 }]
  };
  await seed(page, { programme: [day] });
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();

  const repsInput = page.locator('#repsInput');
  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await expect(repsInput).toHaveValue('12');
  await page.locator('#warmupInput').check();
  await page.locator('#addSetModal button:has-text("Save set")').click();

  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await expect(repsInput).toHaveValue('12');
  await page.locator('#addSetModal button:has-text("Save set")').click();

  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await expect(repsInput).toHaveValue('10');
  await page.locator('#addSetModal button:has-text("Save set")').click();

  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
  await expect(repsInput).toHaveValue('10');
  await repsInput.fill('15');
  await page.locator('#addSetModal button:has-text("Save set")').click();

  const result = await page.evaluate(() => ({
    planned: DB.active.exercises[0].planned,
    sets: DB.active.exercises[0].sets,
    suggestion: suggestFor('Bench Press', false, DB.active.exercises[0].planned)
  }));
  expect(result.planned).toMatchObject({ sets: 3, pyramid: [12, 10, 'max'], progression: 'off' });
  expect(result.sets.map(set => set.reps)).toEqual([12, 12, 10, 15]);
  expect(result.sets[0].phase).toBe('warmup');
  expect(result.sets[3].max).toBe(true);
  expect(result.suggestion).toBeNull();
  await expect(page.locator('#activeExercises .planned-goal')).toContainText('12 · 10 · Max reps · pyramid');
  await expect(page.locator('#activeExercises .set-values').last()).toContainText('MAX');
});
