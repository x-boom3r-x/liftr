const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const routine = {
  id: 'd1', name: 'Upper', type: 'PUSH',
  exercises: [
    { id: 'e1', name: 'Bench press' },
    { id: 'e2', name: 'Barbell row' }
  ]
};

async function openDay(page, id = 'd1'){
  await page.click('button[data-tab="programme"]');
  await page.locator('#daysList [data-day-id="' + id + '"] .programme-day-main').click();
  await expect(page.locator('#dayDetailModal')).toHaveClass(/show/);
}

test.describe('Programmes et organisation des routines', () => {
  test('les journées historiques sont migrées sans perdre leur contenu et la migration est idempotente', async ({ page }) => {
    await seed(page, {
      programme: [routine],
      history: [{ id: 'h1', date: '2026-01-01', dayId: 'd1', dayName: 'Upper', exercises: [{ name: 'Bench press', sets: [{ weight: 60, reps: 8 }] }] }]
    });

    const state = await page.evaluate(() => {
      const before = { day: DB.programme[0], history: DB.history[0] };
      normalizeDB();
      const once = JSON.stringify(DB);
      normalizeDB();
      return {
        once,
        twice: JSON.stringify(DB),
        programId: DB.programme[0].programId,
        programCount: DB.programmes.length,
        activeCount: DB.programmes.filter(p => p.active).length,
        historyDayId: DB.history[0].dayId,
        exerciseName: before.day.exercises[0].name,
        historyWeight: before.history.exercises[0].sets[0].weight
      };
    });

    expect(state.programId).toBeTruthy();
    expect(state.programCount).toBe(1);
    expect(state.activeCount).toBe(1);
    expect(state.historyDayId).toBe('d1');
    expect(state.exerciseName).toBe('Bench press');
    expect(state.historyWeight).toBe(60);
    expect(state.twice).toBe(state.once);
  });

  test('les paramètres restent vides sans afficher undefined, puis persistent après rechargement', async ({ page }) => {
    await seed(page, { programme: [routine] });
    await openDay(page);
    await expect(page.locator('#dayExercises')).not.toContainText('undefined');
    await page.locator('#dayExercises .ex-params summary').first().click();
    await page.locator('#param-sets-e1').fill('4');
    await page.locator('#param-reps-e1').fill('8-12');
    await page.locator('#param-weight-e1').fill('60');
    await page.locator('#param-rest-e1').fill('90');
    await page.locator('#param-notes-e1').fill('Garder une amplitude complète');
    await page.locator('#dayExercises button:has-text("Enregistrer les objectifs")').first().click();

    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    const params = await page.evaluate(() => {
      const ex = DB.programme.find(d => d.id === 'd1').exercises.find(e => e.id === 'e1');
      return { sets: ex.sets, reps: ex.reps, weight: ex.weight, rest: ex.rest, notes: ex.notes };
    });
    expect(params).toEqual({ sets: 4, reps: '8-12', weight: 60, rest: 90, notes: 'Garder une amplitude complète' });
  });

  test('la duplication de programme conserve les paramètres avec de nouveaux identifiants', async ({ page }) => {
    await seed(page, {
      programmes: [
        { id: 'p1', name: 'Force', description: 'Force', active: true },
        { id: 'p2', name: 'Volume', description: 'Volume', active: false }
      ],
      programme: [{ ...routine, programId: 'p1', exercises: [
        { id: 'e1', name: 'Bench press', sets: 4, reps: '8-12', weight: 60, rest: 90, notes: 'Contrôle' },
        { id: 'e2', name: 'Barbell row', sets: 3, reps: 10, weight: 50, rest: 75, notes: '' }
      ] }]
    });

    const result = await page.evaluate(() => {
      const original = DB.programme.find(d => d.id === 'd1').exercises[0];
      const duplicate = duplicateProgramme('p1');
      const day = DB.programme.find(d => d.programId === duplicate.id);
      return { program: duplicate, day, originalId: original.id };
    });
    expect(result.day.exercises[0]).toMatchObject({ sets: 4, reps: '8-12', weight: 60, rest: 90, notes: 'Contrôle' });
    expect(result.day.exercises[0].id).not.toBe(result.originalId);
    expect(result.day.exercises[1]).toMatchObject({ sets: 3, reps: 10, weight: 50, rest: 75 });
  });

  test('groupes superset et circuit peuvent être modifiés puis dissous', async ({ page }) => {
    await seed(page, { programme: [routine] });
    await openDay(page);
    await page.locator('#dayExercises .ex-select').nth(0).check();
    await page.locator('#dayExercises .ex-select').nth(1).check();
    await page.locator('#groupSelectedBtn').click();

    let groups = await page.evaluate(() => DB.programme[0].exercises.map(e => [e.groupId, e.groupType]));
    expect(groups[0][0]).toBeTruthy();
    expect(groups[0][0]).toBe(groups[1][0]);
    expect(groups.map(x => x[1])).toEqual(['superset', 'superset']);

    await page.locator('#dayExercises .ex-group-type').first().selectOption('circuit');
    groups = await page.evaluate(() => DB.programme[0].exercises.map(e => e.groupType));
    expect(groups).toEqual(['circuit', 'circuit']);

    await page.locator('#dayExercises button:has-text("Dissoudre")').first().click();
    expect(await page.evaluate(() => DB.programme[0].exercises.some(e => e.groupId || e.groupType))).toBe(false);
  });

  test('les contrôles accessibles réordonnent les journées et les exercices sur écran tactile', async ({ page }) => {
    const second = { id: 'd2', name: 'Lower', type: 'LEGS', exercises: [{ id: 'e3', name: 'Squat' }] };
    await seed(page, { programme: [routine, second] });
    await page.click('button[data-tab="programme"]');
    await page.locator('#daysList [data-day-id="d1"] button[aria-label="Descendre Upper"]').click();
    expect(await page.evaluate(() => getActiveProgrammeDays().map(d => d.id))).toEqual(['d2', 'd1']);

    await page.locator('#daysList [data-day-id="d1"] .programme-day-main').click();
    await page.locator('#dayExercises button[aria-label="Descendre Bench press"]').click();
    expect(await page.evaluate(() => DB.programme.find(d => d.id === 'd1').exercises.map(e => e.id))).toEqual(['e2', 'e1']);

    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    expect(await page.evaluate(() => getActiveProgrammeDays().map(d => d.id))).toEqual(['d2', 'd1']);
    expect(await page.evaluate(() => DB.programme.find(d => d.id === 'd1').exercises.map(e => e.id))).toEqual(['e2', 'e1']);
  });

  test('le glisser-déposer natif réordonne journées et exercices et sauvegarde leur ordre', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Le glisser-déposer natif est couvert sur ordinateur; le mobile utilise les contrôles tactiles.');
    const second = { id: 'd2', name: 'Lower', type: 'LEGS', exercises: [{ id: 'e3', name: 'Squat' }] };
    await seed(page, { programme: [routine, second] });
    await page.click('button[data-tab="programme"]');

    await page.locator('#daysList [data-day-id="d2"] .day-drag-handle').dragTo(
      page.locator('#daysList [data-day-id="d1"]')
    );
    expect(await page.evaluate(() => getActiveProgrammeDays().map(d => d.id))).toEqual(['d2', 'd1']);

    await page.locator('#daysList [data-day-id="d1"] .programme-day-main').click();
    await page.locator('#dayExercises .ex-drag-handle[data-ex-id="e2"]').dragTo(
      page.locator('#dayExercises .ex-block[data-ex-id="e1"]')
    );
    expect(await page.evaluate(() => DB.programme.find(d => d.id === 'd1').exercises.map(e => e.id))).toEqual(['e2', 'e1']);

    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    expect(await page.evaluate(() => getActiveProgrammeDays().map(d => d.id))).toEqual(['d2', 'd1']);
    expect(await page.evaluate(() => DB.programme.find(d => d.id === 'd1').exercises.map(e => e.id))).toEqual(['e2', 'e1']);
  });

  test('déplacer un exercice conserve ses objectifs et le retire proprement de son groupe', async ({ page }) => {
    const grouped = {
      id: 'd1', name: 'Upper', type: 'PUSH', exercises: [
        { id: 'e1', name: 'Bench press', sets: 4, reps: '8-12', weight: 60, rest: 90, groupId: 'g1', groupType: 'superset' },
        { id: 'e2', name: 'Barbell row', groupId: 'g1', groupType: 'superset' }
      ]
    };
    const second = { id: 'd2', name: 'Lower', type: 'LEGS', exercises: [{ id: 'e3', name: 'Squat' }] };
    await seed(page, { programme: [grouped, second] });
    await openDay(page);
    await page.locator('#dayExercises select[aria-label="Déplacer Bench press vers une journée"]').selectOption('d2');
    const result = await page.evaluate(() => ({
      source: DB.programme.find(d => d.id === 'd1').exercises,
      target: DB.programme.find(d => d.id === 'd2').exercises
    }));
    expect(result.source.map(e => e.id)).toEqual(['e2']);
    expect(result.source[0].groupId).toBeUndefined();
    expect(result.target.find(e => e.id === 'e1')).toMatchObject({ sets: 4, reps: '8-12', weight: 60, rest: 90 });
    expect(result.target.find(e => e.id === 'e1').groupId).toBeUndefined();
  });

  test('les modèles créent une nouvelle journée sans toucher à la source', async ({ page }) => {
    await seed(page, { programme: [{ ...routine, exercises: [
      { id: 'e1', name: 'Bench press', sets: 4, reps: '8-12', weight: 60, rest: 90, notes: 'Contrôle' }
    ] }] });
    page.on('dialog', dialog => dialog.accept('Upper template'));
    await openDay(page);
    await page.locator('#dayDetailModal button:has-text("Enregistrer comme modèle")').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('liftr_dayTemplates_Mouataz') || '[]').length)).toBe(1);
    await page.locator('#dayDetailModal button:has-text("Mes modèles")').click();
    await expect(page.locator('#dayTemplatesModal')).toHaveClass(/show/);
    await page.locator('#dayTemplatesList button:has-text("Utiliser")').click();

    const result = await page.evaluate(() => ({
      days: DB.programme.length,
      source: DB.programme.find(d => d.id === 'd1').exercises[0],
      imported: DB.programme.find(d => d.id !== 'd1').exercises[0]
    }));
    expect(result.days).toBe(2);
    expect(result.source).toMatchObject({ id: 'e1', sets: 4, reps: '8-12', weight: 60, rest: 90, notes: 'Contrôle' });
    expect(result.imported).toMatchObject({ name: 'Bench press', sets: 4, reps: '8-12', weight: 60, rest: 90, notes: 'Contrôle' });
    expect(result.imported.id).not.toBe('e1');
  });
});
