const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

/* M6 — illustrations RepDB : 10 scénarios exigés. L'illustration est
   optionnelle : un exercice sans mapping n'affiche rien et ne casse rien. */

const dayBench = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Bench press' }] };
const daySwim  = { id: 'd2', name: 'B', type: 'CARDIO', exercises: [{ id: 'e2', name: 'Swimming' }] };

async function startSession(page){
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();
  await expect(page.locator('#activeModal')).toHaveClass(/show/);
}
async function openDemoFromActive(page, i){
  await page.locator('#activeExercises .ex-block').nth(i).locator('.ex-demo').click();
  await expect(page.locator('#demoModal')).toHaveClass(/show/);
}

test.describe('Illustrations d\'exercices (RepDB)', () => {

  test('1+3 · exercice illustré : bouton démo, image chargée, multi-étapes navigables', async ({ page }) => {
    await seed(page, { programme: [dayBench] });
    await startSession(page);

    /* scénario 1 : Bench press a une illustration → bouton démo + image */
    await expect(page.locator('#activeExercises .ex-block').first().locator('.ex-demo')).toBeVisible();
    await openDemoFromActive(page, 0);
    await expect(page.locator('#demoTitle')).toHaveText('Bench press');
    const img = page.locator('#demoStage img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', /bench-press/);
    await expect.poll(() => img.evaluate(n => n.complete && n.naturalWidth > 0)).toBe(true);

    /* scénario 3 : Bench press = start + peak → 2 étapes, nav au clavier/boutons */
    const dots = page.locator('#demoNav .demo-dot');
    await expect(dots).toHaveCount(2);
    await expect(page.locator('#demoNav')).toBeVisible();
    await expect(page.locator('#demoPrev')).toBeDisabled();       /* au début */
    await expect(page.locator('#demoNext')).toBeEnabled();
    await expect(page.locator('#demoStage .demo-step-tag')).toContainText('Start');

    await page.locator('#demoNext').click();
    await expect(page.locator('#demoPrev')).toBeEnabled();
    await expect(page.locator('#demoNext')).toBeDisabled();       /* à la fin */
    await expect(page.locator('#demoStage .demo-step-tag')).toContainText('Peak');
    await expect(page.locator('#demoStage img')).toHaveAttribute('src', /bench-press-peak/);

    /* flèche retour → étape 1 */
    await page.locator('#demoPrev').click();
    await expect(page.locator('#demoStage .demo-step-tag')).toContainText('Start');
  });

  test('2 · exercice sans illustration : aucun bouton, aucun thumb, pas de crash', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

    await seed(page, { programme: [daySwim] });
    await startSession(page);

    /* pas de bouton démo pour Swimming */
    await expect(page.locator('#activeExercises .ex-block').first().locator('.ex-demo')).toHaveCount(0);

    /* la grille de la bibliothèque n'a pas de thumb pour Swimming */
    await page.locator('#addExBtn').click();
    await expect(page.locator('#addExModal')).toHaveClass(/show/);
    await page.locator('#addExSearch').fill('Swimming');
    const item = page.locator('#addExGrid .lib-item').filter({ hasText: 'Swimming' }).first();
    await expect(item).toBeVisible();
    await expect(item.locator('.lib-thumb')).toHaveCount(0);

    expect(errs.filter(e => !/favicon/i.test(e))).toEqual([]);
  });

  test('4 · alias français : « développé couché » résout l\'illustration de Bench press', async ({ page }) => {
    await seed(page, { programme: [dayBench] });
    const r = await page.evaluate(() => ({
      fr: illustrationFor('développé couché'),
      thumb: libThumb('développé couché'),
      none: illustrationFor('Swimming')
    }));
    expect(r.fr && r.fr.repdb).toBe('bench-press');
    expect(r.thumb).toContain('lib-thumb');
    expect(r.thumb).toContain('bench-press-start.webp');
    expect(r.none).toBe(null);
  });

  test('5 · image qui échoue : placeholder neutre, pas d\'icône cassée', async ({ page }) => {
    await seed(page, { programme: [dayBench] });
    await startSession(page);
    await openDemoFromActive(page, 0);
    await expect(page.locator('#demoStage img')).toBeVisible();

    /* on force une source introuvable → onerror → fallback */
    await page.evaluate(() => { document.querySelector('#demoStage img').src = 'art/repdb/does-not-exist.webp'; });
    await expect(page.locator('#demoStage .demo-fallback')).toBeVisible();
    await expect(page.locator('#demoStage .demo-fallback')).toHaveText('Preview unavailable');
    await expect(page.locator('#demoStage img')).toBeHidden();
  });

  test('6 · ouvrir/fermer la démo pendant la séance : la séance reste utilisable', async ({ page }) => {
    await seed(page, { programme: [dayBench] });
    await startSession(page);
    await openDemoFromActive(page, 0);

    /* fermeture via la croix */
    await page.locator('#demoModal .modal-x').click();
    await expect(page.locator('#demoModal')).not.toHaveClass(/show/);
    /* la modale de séance est toujours là */
    await expect(page.locator('#activeModal')).toHaveClass(/show/);

    /* réouverture puis fermeture via l'overlay (clic fond) */
    await openDemoFromActive(page, 0);
    await page.locator('#demoModal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#demoModal')).not.toHaveClass(/show/);
    await expect(page.locator('#activeModal')).toHaveClass(/show/);
  });

  test('7 · saisie charges/reps avant et après la démo : rien n\'est perdu', async ({ page }) => {
    await seed(page, { programme: [dayBench] });
    await startSession(page);

    /* une série avant */
    await page.locator('#activeExercises .ex-block').first().locator('.add-set-btn').click();
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await expect(page.locator('#activeExercises .set-row')).toHaveCount(1);

    /* ouvrir/fermer la démo */
    await openDemoFromActive(page, 0);
    await page.locator('#demoModal .modal-x').click();

    /* la série est toujours là + on peut en ajouter une autre */
    await expect(page.locator('#activeExercises .set-row')).toHaveCount(1);
    await page.locator('#activeExercises .ex-block').first().locator('.add-set-btn').click();
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await expect(page.locator('#activeExercises .set-row')).toHaveCount(2);
  });

  test('8 · mobile : la modale démo ne déborde pas horizontalement', async ({ page }) => {
    await seed(page, { programme: [dayBench] });
    await startSession(page);
    await openDemoFromActive(page, 0);

    const overflow = await page.evaluate(() => {
      const m = document.querySelector('#demoModal .modal');
      return { modal: m.scrollWidth - m.clientWidth, doc: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(overflow.modal, 'débordement interne de la modale').toBeLessThanOrEqual(1);
    expect(overflow.doc, 'débordement horizontal du document').toBeLessThanOrEqual(1);
  });

  test('9 · perf : les miniatures de la bibliothèque sont lazy (chargement à la demande)', async ({ page }) => {
    await seed(page, { programme: [dayBench] });
    await startSession(page);
    await page.locator('#addExBtn').click();
    await expect(page.locator('#addExModal')).toHaveClass(/show/);
    /* au moins un thumb présent et tous lazy */
    const thumbs = page.locator('#addExGrid .lib-thumb');
    expect(await thumbs.count()).toBeGreaterThan(0);
    const allLazy = await thumbs.evaluateAll(nodes => nodes.every(n => {
      const img = n.querySelector('img');
      return img && img.getAttribute('loading') === 'lazy';
    }));
    expect(allLazy, 'toutes les miniatures doivent être lazy').toBe(true);
  });

  test('10 · non-régression : fin de séance → historique écrit, programme intact', async ({ page }) => {
    page.on('dialog', d => d.accept());   /* confirm() de finishSession */
    await seed(page, { programme: [dayBench] });
    await startSession(page);

    /* on ouvre la démo (ne doit pas perturber), on ajoute une série, on finit */
    await openDemoFromActive(page, 0);
    await page.locator('#demoModal .modal-x').click();
    await page.locator('#activeExercises .ex-block').first().locator('.add-set-btn').click();
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await page.locator('#activeModal button:has-text("Finish session")').click();
    await expect(page.locator('#activeModal')).not.toHaveClass(/show/);

    /* l'historique contient bien la séance, le programme est intact */
    const st = await page.evaluate(() => ({
      hist: DB.history.length,
      bench: (DB.programme[0].exercises || []).map(e => e.name)
    }));
    expect(st.hist).toBe(1);
    expect(st.bench).toContain('Bench press');
  });
});
