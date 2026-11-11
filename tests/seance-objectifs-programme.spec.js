const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const plan = {
  id: 'phase23-day', name: 'Upper A', type: 'UPPER', programId: 'phase23-program', order: 0,
  exercises: [
    { id: 'bench', name: 'Bench Press', order: 0, sets: '3', reps: '8-12', weight: 40, rest: 90, notes: 'Pause at chest', groupId: 'pair-a', groupType: 'superset' },
    { id: 'row', name: 'Barbell Row', order: 1, sets: '3', reps: '8-12', weight: 32.5, rest: 75, notes: 'Controlled lowering', groupId: 'pair-a', groupType: 'superset' },
    { id: 'fly', name: 'Cable Fly', order: 2, sets: '2', reps: '12', weight: 10, rest: 60, notes: 'Stretch', groupId: 'pair-b', groupType: 'circuit' },
    { id: 'pushup', name: 'Push-Up', order: 3, sets: '2', reps: 'AMRAP', weight: null, rest: 45, notes: '', groupId: 'pair-b', groupType: 'circuit' }
  ]
};
const program = { id: 'phase23-program', name: 'Hypertrophy block', active: true };

async function startPlannedSession(page){
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();
  await expect(page.locator('#activeModal')).toHaveClass(/show/);
}

test.describe('Objectifs du programme et résultats de séance', () => {
  test('importe les objectifs dans l’ordre sans modifier la journée du programme', async ({ page }) => {
    await seed(page, { programmes: [program], programme: [plan] });
    await startPlannedSession(page);

    const state = await page.evaluate(() => ({
      names: DB.active.exercises.map(e => e.name),
      targets: DB.active.exercises.map(e => e.planned),
      actualSets: DB.active.exercises.map(e => e.sets),
      source: [DB.active.sourceType, DB.active.programId, DB.active.programName, DB.active.dayId],
      original: DB.programme[0].exercises.map(e => ({ name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, groupId: e.groupId }))
    }));
    expect(state.names).toEqual(['Bench Press', 'Barbell Row', 'Cable Fly', 'Push-Up']);
    expect(state.source).toEqual(['program', 'phase23-program', 'Hypertrophy block', 'phase23-day']);
    expect(state.targets[0]).toMatchObject({ sets: '3', reps: '8-12', weight: 40, rest: 90, notes: 'Pause at chest', groupType: 'superset', groupIndex: 1, groupCount: 2 });
    expect(state.targets[1]).toMatchObject({ groupType: 'superset', groupIndex: 2, groupCount: 2 });
    expect(state.targets[2]).toMatchObject({ groupType: 'circuit', groupIndex: 1, groupCount: 2 });
    expect(state.targets[3]).toMatchObject({ groupType: 'circuit', groupIndex: 2, groupCount: 2 });
    expect(state.actualSets).toEqual([[], [], [], []]);
    expect(state.original[0]).toMatchObject({ sets: '3', reps: '8-12', weight: 40, groupId: 'pair-a' });

    const blocks = page.locator('#activeExercises .ex-block');
    await expect(blocks).toHaveCount(4);
    await expect(blocks.nth(0).locator('.planned-goal')).toContainText('3 sets · 8-12 reps · 40 kg · 90 s rest');
    await expect(blocks.nth(0).locator('.planned-goal')).toContainText('Superset · 1/2');
    await expect(blocks.nth(0).locator('.planned-goal')).toContainText('Pause at chest');
    await expect(blocks.nth(2).locator('.planned-goal')).toContainText('Circuit · 1/2');
  });

  test('préremplit depuis la cible, garde les résultats distincts et archive uniquement les séries réelles', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await seed(page, { programmes: [program], programme: [plan] });
    await startPlannedSession(page);

    await page.locator('#activeExercises button:has-text("+ Set")').first().click();
    await expect(page.locator('#weightInput')).toHaveValue('40');
    await expect(page.locator('#repsInput')).toHaveValue('8');
    await expect(page.locator('#plannedSetPrefill')).toBeVisible();
    await page.locator('#repsInput').fill('12');
    await page.locator('#addSetModal button:has-text("Save set")').click();

    await page.locator('#activeExercises button:has-text("+ Set")').first().click();
    await page.locator('#weightInput').fill('42.5');
    await page.locator('#repsInput').fill('8');
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await page.reload();
    await expect(page.locator('.sess-banner')).toBeVisible();
    await page.locator('.sess-banner button:has-text("Resume")').click();
    await expect(page.locator('#activeExercises .planned-goal').first()).toContainText('40 kg');

    const beforeFinish = await page.evaluate(() => ({
      target: DB.active.exercises[0].planned,
      sets: DB.active.exercises[0].sets,
      programmeWeight: DB.programme[0].exercises[0].weight
    }));
    expect(beforeFinish.target.weight).toBe(40);
    expect(beforeFinish.target.reps).toBe('8-12');
    expect(beforeFinish.sets).toEqual([
      { weight: 40, reps: 12, assisted: 0 },
      { weight: 42.5, reps: 8, assisted: 0 }
    ]);
    expect(beforeFinish.programmeWeight).toBe(40);

    await page.locator('#activeModal button:has-text("Finish session")').click();
    const history = await page.evaluate(() => DB.history[0]);
    expect(history).toMatchObject({ sourceType: 'program', programId: 'phase23-program', programName: 'Hypertrophy block', dayId: 'phase23-day', totalSets: 2, volume: 820 });
    expect(history.exercises).toHaveLength(1);
    expect(history.exercises[0].sets).toEqual(beforeFinish.sets);
    expect(history.plannedExercises).toHaveLength(4);
    expect(history.plannedExercises[0].planned).toMatchObject({ weight: 40, reps: '8-12', groupType: 'superset' });

    const historyId = await page.evaluate(() => {
      DB.programme[0].exercises[0].weight = 55;
      save();
      return DB.history[0].id;
    });
    await page.evaluate(() => { DB.programme = []; DB.programmes = []; save(); });
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await page.evaluate(id => openSessionDetail(id), historyId);
    await expect(page.locator('#daySheetContent')).toContainText('Original session from Hypertrophy block');
    await expect(page.locator('#daySheetContent')).toContainText('Results recorded');
    await expect(page.locator('#daySheetContent')).toContainText('Programmed objectives');
    await expect(page.locator('#daySheetContent')).toContainText('42.5 kg × 8');
    await expect(page.locator('#daySheetContent .history-planned-ex').first()).toContainText('40 kg');
    await expect(page.locator('#daySheetSub')).toContainText('820');
  });

  test('permet une séance libre sans inventer de cible et conserve ses résultats', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await seed(page);
    await page.click('button[data-tab="seance"]');
    await page.locator('#tab-seance button:has-text("Start a free session")').click();
    await expect(page.locator('#activeTitle')).toHaveText('Free session');
    await expect(page.locator('#activeExercises .planned-goal')).toHaveCount(0);

    await page.locator('#addExBtn').click();
    await page.locator('#addExCustom').fill('Deadlift');
    await page.locator('#addExModal .btn.btn-primary').click();
    await page.locator('#addExModal button:has-text("Done")').click();
    await expect(page.locator('#activeExercises .ex-block')).toContainText('Deadlift');
    await expect(page.locator('#sessRecap')).toBeHidden();

    await page.locator('#activeExercises button:has-text("+ Set")').click();
    await expect(page.locator('#plannedSetPrefill')).toBeHidden();
    await page.locator('#weightInput').fill('100');
    await page.locator('#repsInput').fill('5');
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await page.reload();
    await expect(page.locator('.sess-banner')).toBeVisible();
    await page.locator('.sess-banner button:has-text("Resume")').click();
    await expect(page.locator('#activeExercises .planned-goal')).toHaveCount(0);

    await page.locator('#activeModal button:has-text("Finish session")').click();
    const history = await page.evaluate(() => DB.history[0]);
    expect(history).toMatchObject({ sourceType: 'free', programId: null, dayId: null, totalSets: 1, volume: 500, plannedExercises: [] });
    expect(history.exercises[0].sets).toEqual([{ weight: 100, reps: 5, assisted: 0 }]);
    await page.evaluate(() => openSessionDetail(DB.history[0].id));
    await expect(page.locator('#daySheetContent')).toContainText('Free session · no programmed objectives.');
    await expect(page.locator('#daySheetContent')).not.toContainText('Programmed objectives');
    await expect(page.locator('#daySheetContent')).toContainText('100 kg × 5');
  });

  test('utilise le repos programmé pour chaque exercice, puis revient à 90 s sans cible', async ({ page }) => {
    const restDay = {
      id: 'rest-day', name: 'Rest targets', type: 'UPPER',
      exercises: [
        { id: 'bench-rest', name: 'Bench Press', rest: 60 },
        { id: 'row-rest', name: 'Barbell Row', rest: 75 },
        { id: 'fly-rest', name: 'Cable Fly' },
        { id: 'ohp-no-rest', name: 'Overhead Press', rest: 0 }
      ]
    };
    await seed(page, { programme: [restDay] });
    await startPlannedSession(page);

    for (const [index, expected] of [[0, 60], [1, 75], [2, 90], [3, 0]]){
      await page.locator('#activeExercises .ex-block').nth(index).locator('button:has-text("+ Set")').click();
      await page.locator('#addSetModal button:has-text("Save set")').click();
      expect(await page.evaluate(() => DB.active.restSecs)).toBe(expected);
      if (expected === 0){
        expect(await page.evaluate(() => DB.active.restUntil)).toBeUndefined();
        await expect(page.locator('#restStartBtn')).toBeVisible();
      } else await page.locator('#restRunning button:has-text("Skip")').click();
    }
  });

  test('reste compatible avec une ancienne séance active et un historique sans objectifs', async ({ page }) => {
    const oldDay = { id: 'legacy-day', name: 'Legacy', exercises: [{ id: 'legacy-ex', name: 'Old Lift' }] };
    const oldHistory = {
      id: 'legacy-history', date: '2026-11-09', dayId: 'legacy-day', dayName: 'Legacy',
      exercises: [{ id: 'legacy-ex', name: 'Old Lift', sets: [{ weight: 20, reps: 10, assisted: 0 }] }],
      totalSets: 1, volume: 200
    };
    await seed(page, {
      programme: [oldDay], history: [oldHistory],
      active: { id: 'legacy-active', dayId: 'legacy-day', dayName: 'Legacy', startedAt: Date.now(), note: '', exercises: [{ id: 'legacy-ex', name: 'Old Lift', sets: [] }] }
    });
    await expect(page.locator('.sess-banner')).toBeVisible();
    await page.locator('.sess-banner button:has-text("Resume")').click();
    await expect(page.locator('#activeExercises .planned-goal')).toHaveCount(0);
    await page.locator('#activeExercises button:has-text("+ Set")').click();
    await expect(page.locator('#plannedSetPrefill')).toBeHidden();
    await expect(page.locator('#weightInput')).toHaveValue('20');
    await expect(page.locator('#repsInput')).toHaveValue('10');
    await page.locator('#addSetModal').getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.evaluate(() => openSessionDetail('legacy-history'));
    await expect(page.locator('#daySheetContent')).toContainText('Results recorded');
    await expect(page.locator('#daySheetContent')).not.toContainText('Programmed objectives');
    await expect(page.locator('#daySheetContent')).toContainText('20 kg × 10');
  });
});
