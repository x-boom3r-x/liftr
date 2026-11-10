const { test, expect } = require('@playwright/test');
const { seed, dbState } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Bench press' }] };

async function startSession(page){
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();
  await expect(page.locator('#activeModal')).toHaveClass(/show/);
}

/* Enregistre une série dans le bloc d'exercice n°i (0 = premier de la séance) */
async function addSetTo(page, i){
  await page.locator('#activeExercises .ex-block').nth(i).locator('.add-set-btn').click();
  await expect(page.locator('#addSetModal')).toHaveClass(/show/);
  await page.locator('#addSetModal button:has-text("Save set")').click();
}

async function openAddEx(page){
  await page.locator('#addExBtn').click();
  await expect(page.locator('#addExModal')).toHaveClass(/show/);
}

async function pickLibraryItem(page, name){
  await page.locator('.lib-item[data-name="' + name + '"]').click();
}

async function closeAddEx(page){
  await page.locator('#addExModal button:has-text("Done")').click();
  await expect(page.locator('#addExModal')).not.toHaveClass(/show/);
}

async function finishSession(page){
  await page.locator('#activeModal button:has-text("Finish session")').click();
  await expect(page.locator('#activeModal')).not.toHaveClass(/show/);
}

test.describe('Ajouter un exercice pendant la séance', () => {

  test('le bouton ouvre la recherche d’exercices (chips, grille, champ custom)', async ({ page }) => {
    const errs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));

    await seed(page, { programme: [dayA] });
    await startSession(page);
    await openAddEx(page);

    await expect(page.locator('#addExChips .lib-chip').first()).toContainText('All');
    await expect(page.locator('#addExGrid .lib-item').first()).toBeVisible();
    await expect(page.locator('#addExHint')).toContainText(/exercise|exercises/);

    await page.locator('#addExSearch').fill('squat');
    const names = await page.locator('#addExGrid .lib-item').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n.toLowerCase()).toContain('squat');

    await page.locator('#addExSearch').fill('zzzz-no-match');
    await expect(page.locator('#addExGrid .lib-item')).toHaveCount(0);
    await expect(page.locator('.lib-empty')).toBeVisible();

    expect(errs).toEqual([]);
  });

  test('un exercice ajouté est marqué « New » et ne touche pas au programme', async ({ page }) => {
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await openAddEx(page);
    await pickLibraryItem(page, 'barbell squat');
    await closeAddEx(page);

    const st = await page.evaluate(() => ({
      n: DB.active.exercises.length,
      extra: DB.active.exercises[1].extra,
      name: DB.active.exercises[1].name,
      sets: DB.active.exercises[1].sets.length
    }));
    expect(st).toEqual({ n: 2, extra: true, name: 'barbell squat', sets: 0 });

    const block = page.locator('#activeExercises .ex-block').nth(1);
    await expect(block).toContainText('barbell squat');
    await expect(block.locator('.chip-extra')).toHaveText('New');
    await expect(block.locator('.ex-del')).toBeVisible();
    expect((await dbState(page)).programme).toBe(1);
  });

  test('un exercice planifié non fait affiche « not done today » et le panneau recap', async ({ page }) => {
    await seed(page, { programme: [dayA] });
    await startSession(page);

    await expect(page.locator('#activeExercises .ex-empty')).toContainText('not done today');
    await expect(page.locator('#activeSub')).toHaveText(/0\/1 done/);

    await expect(page.locator('#sessRecap')).toBeVisible();
    await expect(page.locator('.recap-title')).toHaveText('Compared with your program');
    await expect(page.locator('.recap-score')).toHaveText('0/1 done');
    await expect(page.locator('.recap-sel')).toHaveCount(0);
    await expect(page.locator('.recap-sub')).toContainText('Not done today');
    await expect(page.locator('.recap-miss')).toContainText('Bench press');
    await expect(page.locator('.recap-miss .recap-tag')).toContainText('Skipped');
  });

  test('tout faire masque le panneau recap (aucun écart)', async ({ page }) => {
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await expect(page.locator('#sessRecap')).toBeVisible();

    await addSetTo(page, 0);

    await expect(page.locator('#activeSub')).toHaveText(/1\/1 done/);
    await expect(page.locator('#sessRecap')).toBeHidden();
    expect(await page.locator('#sessRecap').innerHTML()).toBe('');
  });

  test('les chips de groupes filtrent la grille', async ({ page }) => {
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await openAddEx(page);

    await page.locator('#addExChips .lib-chip').filter({ hasText: 'Legs' }).click();
    const names = await page.locator('#addExGrid .lib-item').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(n => n.includes('Legs'))).toBe(true);
    await expect(page.locator('#addExHint')).toContainText('shown');
  });

  test('le champ custom ajoute un exercice hors bibliothèque et l’enregistre dans Custom', async ({ page }) => {
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await openAddEx(page);

    await page.locator('#addExCustom').fill('Marteau tibial');
    await page.locator('#addExModal .btn.btn-primary').click();
    /* le rendu de la modale peut re-peindre entre le hit-test et le mouse-up
       sous charge : on attend l'effet plutôt que de deviner le timing. */
    await page.waitForFunction(() =>
      window.DB && DB.active && (DB.active.exercises || []).length >= 2);

    const st = await page.evaluate(() => ({
      extra: DB.active.exercises[1].extra,
      name: DB.active.exercises[1].name,
      custom: DB.custom
    }));
    expect(st.extra).toBe(true);
    expect(st.name).toBe('Marteau tibial');
    expect(st.custom).toContain('Marteau tibial');
    await expect(page.locator('#addExCustom')).toHaveValue('');

    await closeAddEx(page);
    await expect(page.locator('#activeExercises .ex-block').nth(1)).toContainText('Marteau tibial');
  });

  test('retirer l’exercice ajouté le supprime de la séance et efface l’écart', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await addSetTo(page, 0);

    await openAddEx(page);
    await pickLibraryItem(page, 'barbell squat');
    await closeAddEx(page);
    await addSetTo(page, 1);

    await expect(page.locator('#sessRecap')).toBeVisible();
    await expect(page.locator('.recap-sel')).toHaveCount(1);

    await page.locator('#activeExercises .ex-block').nth(1).locator('.ex-del').click();

    expect(await page.evaluate(() => DB.active.exercises.length)).toBe(1);
    await expect(page.locator('#activeExercises .ex-block')).toHaveCount(1);
    await expect(page.locator('#sessRecap')).toBeHidden();
  });

  test('choix « Add ... to A » : à la fin, l’exercice rejoint le programme', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await openAddEx(page);
    await pickLibraryItem(page, 'barbell squat');
    await closeAddEx(page);
    await addSetTo(page, 1);

    await page.locator('.recap-sel').selectOption('add');
    await expect(page.locator('.recap-sel')).toHaveValue('add');

    await finishSession(page);

    const st = await page.evaluate(() => ({
      prog: DB.programme[0].exercises.map(e => e.name),
      missing: DB.history[0].missing,
      added: DB.history[0].added,
      active: DB.active
    }));
    expect(st.prog).toEqual(['Bench press', 'barbell squat']);
    expect(st.missing).toEqual(['Bench press']);
    expect(st.added).toEqual([{ name: 'barbell squat', action: 'added' }]);
    expect(st.active).toBeNull();
  });

  test('choix « Replace ... » : l’exercice remplacé change dans le programme', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await openAddEx(page);
    await pickLibraryItem(page, 'barbell squat');
    await closeAddEx(page);
    await addSetTo(page, 1);

    await page.locator('.recap-sel').selectOption('replace:e1');
    await expect(page.locator('.recap-miss .recap-tag')).toContainText('replaced by barbell squat');

    await finishSession(page);

    const st = await page.evaluate(() => ({
      prog: DB.programme[0].exercises.map(e => e.name),
      missing: DB.history[0].missing,
      added: DB.history[0].added
    }));
    expect(st.prog).toEqual(['barbell squat']);
    expect(st.missing).toEqual(['Bench press']);
    expect(st.added).toEqual([{ name: 'barbell squat', action: 'replaced', replaces: 'Bench press' }]);
  });

  test('sans choix : le programme ne bouge pas et l’exercice reste hors programme', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await openAddEx(page);
    await pickLibraryItem(page, 'barbell squat');
    await closeAddEx(page);
    await addSetTo(page, 1);

    await finishSession(page);

    const st = await page.evaluate(() => ({
      prog: DB.programme[0].exercises.map(e => e.name),
      missing: DB.history[0].missing,
      added: DB.history[0].added
    }));
    expect(st.prog).toEqual(['Bench press']);
    expect(st.missing).toEqual(['Bench press']);
    expect(st.added).toEqual([{ name: 'barbell squat', action: 'kept' }]);
  });

  test('les écarts sont affichés dans le détail de la séance (Stats)', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA] });
    await startSession(page);
    await openAddEx(page);
    await pickLibraryItem(page, 'barbell squat');
    await closeAddEx(page);
    await addSetTo(page, 1);
    await page.locator('.recap-sel').selectOption('add');
    await finishSession(page);

    await page.click('button[data-tab="stats"]');
    await page.locator('#statsContent .hist-item').first().click();
    await expect(page.locator('#daySheetModal')).toHaveClass(/show/);

    await expect(page.locator('#daySheetContent .hist-diff')).toBeVisible();
    await expect(page.locator('.diff-line.miss')).toContainText('Bench press: not done');
    await expect(page.locator('.diff-line.add')).toContainText('barbell squat · added to the program');
  });

  test('deux exercices ajoutés, deux choix, aucune erreur console', async ({ page }) => {
    const errs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    page.on('dialog', d => d.accept());

    await seed(page, { programme: [dayA] });
    await startSession(page);

    await openAddEx(page);
    await pickLibraryItem(page, 'barbell squat');
    await page.locator('#addExSearch').fill('hip');
    await pickLibraryItem(page, 'barbell hip thrust');
    await closeAddEx(page);

    await addSetTo(page, 1);
    await addSetTo(page, 2);

    await expect(page.locator('#sessRecap .recap-sel')).toHaveCount(2);
    await page.locator('.recap-sel').first().selectOption('add');
    await page.locator('.recap-sel').last().selectOption('add');

    await finishSession(page);

    const prog = await page.evaluate(() => DB.programme[0].exercises.map(e => e.name));
    expect(prog).toEqual(['Bench press', 'barbell squat', 'barbell hip thrust']);
    expect(errs).toEqual([]);
  });
});
