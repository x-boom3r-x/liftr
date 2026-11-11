const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const latest = (sets, planned) => ({
  id: 'history-1', date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  dayId: 'day-1', dayName: 'A',
  exercises: [{ id: 'bench', name: 'Bench Press', sets }],
  plannedExercises: [{ id: 'bench', name: 'Bench Press', planned }]
});

async function openSuggestion(page, reps, sets, historySets, previousPlan, currentWeight = 60, progression = 'double', setsMax = null){
  const day = { id: 'day-1', name: 'A', type: 'PUSH', exercises: [
    { id: 'bench', name: 'Bench Press', sets, reps, weight: currentWeight, progression, ...(setsMax ? { setsMax } : {}) }
  ] };
  await seed(page, { programme: [day], history: [latest(historySets, previousPlan || { sets, reps, weight: currentWeight, progression })] });
  await page.click('button[data-tab="seance"]');
  await page.locator('#tab-seance button:has-text("Start")').first().click();
  await page.locator('#activeExercises button:has-text("+ Set")').first().click();
}

test('double progression: augmente les répétitions dans une plage avant la charge', async ({ page }) => {
  await openSuggestion(page, '8-12', 2, [
    { weight: 60, reps: 8 }, { weight: 60, reps: 8 }
  ]);
  await expect(page.locator('.ctx-sug')).toContainText('60 kg × 9');
  await expect(page.locator('.ctx-sug')).toContainText('top of the range');
});

test('une séance avec des séries programmées manquantes ne fait pas augmenter la charge', async ({ page }) => {
  await openSuggestion(page, '10', 3, [
    { weight: 60, reps: 10 }, { weight: 60, reps: 10 }
  ]);
  await expect(page.locator('.ctx-sug')).toContainText('60 kg × 10');
  await expect(page.locator('.ctx-sug')).toContainText('not all programmed sets were logged');
});

test('les échauffements tardifs dans l’historique ne déterminent pas la suggestion', async ({ page }) => {
  await openSuggestion(page, '8', 1, [
    { weight: 60, reps: 8 }, { weight: 120, reps: 20, phase: 'warmup' }
  ]);
  await expect(page.locator('.ctx-sug')).toContainText('62.5 kg × 8');
});

test('les séries bonus après le plan ne déclenchent pas une hausse de charge', async ({ page }) => {
  await openSuggestion(page, '8', 2, [
    { weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 100, reps: 20 }
  ]);
  await expect(page.locator('.ctx-sug')).toContainText('62.5 kg × 8');
});

test('un changement des objectifs du programme repart de la cible mise à jour', async ({ page }) => {
  await openSuggestion(page, '10', 3, [
    { weight: 60, reps: 10 }, { weight: 60, reps: 10 }, { weight: 60, reps: 10 }
  ], { sets: 3, reps: '8-12', weight: 60 }, 65);
  await expect(page.locator('.ctx-sug')).toContainText('65 kg × 10');
  await expect(page.locator('.ctx-sug')).toContainText('programmed target changed');
});

test('la politique linéaire garde la charge jusqu’au haut de la plage', async ({ page }) => {
  await openSuggestion(page, '8-12', 2, [
    { weight: 60, reps: 8 }, { weight: 60, reps: 8 }
  ], null, 60, 'linear');
  await expect(page.locator('.ctx-sug')).toContainText('60 kg × 12');
  await expect(page.locator('.ctx-sug')).toContainText('Linear progression');
});

test('la politique manuelle ne propose pas de cible automatique', async ({ page }) => {
  await openSuggestion(page, '8', 2, [
    { weight: 60, reps: 8 }, { weight: 60, reps: 8 }
  ], null, 60, 'off');
  await expect(page.locator('.ctx-sug')).toHaveCount(0);
});

test('Greyskull réduit la charge quand la dernière série marquée à l’échec manque la cible', async ({ page }) => {
  await openSuggestion(page, '8', 3, [
    { weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 6, failure: true }
  ], null, 60, 'greyskull');
  await expect(page.locator('.ctx-sug')).toContainText('54 kg × 8');
  await expect(page.locator('.ctx-sug')).toContainText('about 10%');
});

test('triple progression : les répétitions montent avant l’ajout d’une série', async ({ page }) => {
  await openSuggestion(page, '8-12', 3, [
    { weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }
  ], { sets: 3, setsMax: 5, reps: '8-12', weight: 60, progression: 'triple' }, 60, 'triple', 5);
  await expect(page.locator('.ctx-sug')).toContainText('60 kg × 9 · 3 sets');
});

test('triple progression : le programme conserve le plafond de séries au rechargement', async ({ page }) => {
  const day = { id: 'triple-day', name: 'A', type: 'PUSH', exercises: [
    { id: 'bench', name: 'Bench Press', sets: 3, reps: '8-12', weight: 60 }
  ] };
  await seed(page, { programme: [day] });
  await page.evaluate(() => setExerciseParams(DB.programme[0].exercises[0], {
    sets: 3, setsMax: 5, reps: '8-12', weight: 60, progression: 'triple'
  }));
  await page.reload();
  const saved = await page.evaluate(() => getExerciseParams(DB.programme[0].exercises[0]));
  expect(saved).toMatchObject({ sets: 3, setsMax: 5, progression: 'triple', reps: '8-12' });
});

test('triple progression : après le haut des séries de base, suggère une série supplémentaire au minimum', async ({ page }) => {
  await openSuggestion(page, '8-12', 3, [
    { weight: 60, reps: 12 }, { weight: 60, reps: 12 }, { weight: 60, reps: 12 }
  ], { sets: 3, setsMax: 5, reps: '8-12', weight: 60, progression: 'triple' }, 60, 'triple', 5);
  await expect(page.locator('.ctx-sug')).toContainText('60 kg × 8 · 4 sets');
  await expect(page.locator('.ctx-sug')).toContainText('add one set');
});

test('triple progression : conserve la série ajoutée puis augmente la charge au plafond', async ({ page }) => {
  await openSuggestion(page, '8-12', 3, [
    { weight: 60, reps: 12 }, { weight: 60, reps: 12 }, { weight: 60, reps: 12 },
    { weight: 60, reps: 12 }, { weight: 60, reps: 12 }
  ], { sets: 3, setsMax: 5, reps: '8-12', weight: 60, progression: 'triple' }, 60, 'triple', 5);
  await expect(page.locator('.ctx-sug')).toContainText('62.5 kg × 8 · 3 sets');
  await expect(page.locator('.ctx-sug')).toContainText('restart at the base sets');
});
