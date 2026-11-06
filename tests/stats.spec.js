const { test, expect } = require('@playwright/test');
const { seed, dbState, today, daysAgo } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }, { id: 'e2', name: 'Squat barre' }] };
const dayB = { id: 'd2', name: 'B', type: 'PULL', exercises: [{ id: 'e3', name: 'Tractions pronation' }] };

const S = (w, r) => ({ weight: w, reps: r, assisted: 0 });
const ex = (name, sets) => ({ id: name.toLowerCase().replace(/\W/g, '').slice(0, 6), name: name, sets: sets });

function sess(id, date, dayId, dayName, exercises, volume){
  return {
    id, date, dayId, dayName, exercises,
    totalSets: exercises.reduce((n, e) => n + e.sets.length, 0),
    volume, note: '', performed: 1
  };
}

/* 60×8 = 76 e1RM puis 65×6 = 78 e1RM (Epley) */
function growthHistory(){
  return [
    sess('h1', daysAgo(45), 'd1', 'A', [ex('Développé couché', [S(60, 8)])], 480),
    sess('h2', daysAgo(5), 'd1', 'A', [ex('Développé couché', [S(65, 6)])], 390)
  ];
}

test.describe('Tableau de bord Stats', () => {

  test('profil vide : état vide élégant, plus de score ni de compteurs génériques', async ({ page }) => {
    await seed(page, {});
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.dash-empty')).toBeVisible();
    await expect(page.locator('.dash-empty')).toContainText('Not enough data yet');
    await expect(page.locator('.dash-empty')).toContainText('Keep logging your workouts');
    await expect(page.locator('.score-card, .score-part, .score-num')).toHaveCount(0);
    await expect(page.locator('.perf-card, .pr-card, .vol-card, .musc-card')).toHaveCount(0);
    await expect(page.locator('#statsContent')).not.toContainText('Fitness score');
    await expect(page.locator('#statsContent')).not.toContainText('Fill rate');
  });

  test('Performance : estimated e1RM, variation et courbe', async ({ page }) => {
    await seed(page, { programme: [dayA], history: growthHistory() });
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.perf-card')).toBeVisible();
    await expect(page.locator('.perf-card .perf-label')).toContainText('Développé couché');
    await expect(page.locator('.perf-card .perf-value')).toContainText('78');
    await expect(page.locator('.perf-card .perf-delta')).toContainText('+2.6 %');
    await expect(page.locator('.perf-card .perf-delta')).toHaveClass(/up/);
    await expect(page.locator('.perf-card .perf-sub')).toContainText('estimated e1RM');
    expect(await page.locator('.perf-card .dchart polyline').count()).toBe(1);
    await expect(page.locator('.perf-card .chart-x')).toBeVisible();
  });

  test('filtre de période 4W : une seule mesure, plus de variation', async ({ page }) => {
    await seed(page, { programme: [dayA], history: growthHistory() });
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.perf-card .range-opt.on')).toHaveText('3M');
    await page.locator('.perf-card [data-per="28"]').click();

    await expect(page.locator('.perf-card .range-opt.on')).toHaveText('4W');
    await expect(page.locator('.perf-card .perf-value')).toContainText('78');
    await expect(page.locator('.perf-card .perf-delta')).toHaveCount(0);
  });

  test('sélecteur d\'exercice partagé entre Performance et Progression', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: [
        sess('h1', daysAgo(3), 'd1', 'A', [ex('Développé couché', [S(60, 8)])], 480),
        sess('h2', daysAgo(1), 'd1', 'A', [ex('Squat barre', [S(100, 5)])], 500)
      ]
    });
    await page.click('button[data-tab="stats"]');

    /* le plus récent est sélectionné par défaut */
    await expect(page.locator('.perf-card .perf-label')).toContainText('Squat barre');
    await expect(page.locator('.perf-card .perf-value')).toContainText('116.7');
    await expect(page.locator('.prog-card .perf-label')).toContainText('Squat barre');

    await page.locator('.perf-card .ex-chip:has-text("Développé couché")').click();

    await expect(page.locator('.perf-card .perf-label')).toContainText('Développé couché');
    await expect(page.locator('.perf-card .perf-value')).toContainText('76');
    await expect(page.locator('.prog-card .perf-label')).toContainText('Développé couché');
  });

  test('Records : badge « +5 kg » issu du journal, « NEW PR » si récent', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      prs: {
        'développé couché': { name: 'Développé couché', weight: 95, reps: 5, assisted: 0, date: daysAgo(3) },
        'squat barre': { name: 'Squat barre', weight: 140, reps: 5, assisted: 0, date: today() }
      },
      prLog: [
        { date: daysAgo(3), key: 'développé couché', name: 'Développé couché', weight: 95, reps: 5, assisted: 0, prev: { weight: 90, reps: 5, assisted: 0 } }
      ]
    });
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.pr-card')).toHaveCount(2);
    /* triées de la plus récente à la plus ancienne */
    await expect(page.locator('.pr-card').first()).toContainText('Squat barre');
    await expect(page.locator('.pr-badge.new')).toHaveText('NEW PR');
    await expect(page.locator('.pr-badge.up')).toHaveText('+5 kg');
    await expect(page.locator('.pr-value').last()).toContainText('95');
  });

  test('Progression : 4 métriques réelles et changement de métrique', async ({ page }) => {
    await seed(page, { programme: [dayA], history: growthHistory() });
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.prog-card')).toBeVisible();
    await expect(page.locator('.prog-cells .stat-value')).toHaveCount(4);
    const cells = await page.locator('.prog-cells .stat-label').allTextContents();
    expect(cells).toEqual(['estimated e1RM', 'Best weight', 'Best reps', 'Total volume']);
    const vals = await page.locator('.prog-cells .stat-value').allTextContents();
    expect(vals[0]).toBe('78');   /* meilleur e1RM */
    expect(vals[1]).toBe('65');   /* meilleur poids */
    expect(vals[2]).toBe('8');    /* meilleures reps */
    expect(vals[3]).toBe('870 kg');  /* volume cumulé 480 + 390 */

    await expect(page.locator('.prog-card .range-opt.on')).toHaveText('1RM');
    await page.locator('.prog-card [data-metric="volume"]').click();
    await expect(page.locator('.prog-card .range-opt.on')).toHaveText('Volume');
    expect(await page.locator('.prog-card .dchart polyline').count()).toBe(1);
  });

  test('Volume : période en cours vs précédente, filtre 7D', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: [
        sess('h1', today(), 'd1', 'A', [ex('Développé couché', [S(60, 8)])], 700),
        sess('h2', daysAgo(10), 'd1', 'A', [ex('Développé couché', [S(60, 8)])], 300),
        sess('h3', daysAgo(40), 'd1', 'A', [ex('Développé couché', [S(60, 8)])], 500)
      ]
    });
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.vol-card')).toBeVisible();
    await expect(page.locator('.vol-card .range-opt.on')).toHaveText('30D');
    await expect(page.locator('.vol-card .vol-value')).toContainText('1.0k');
    await expect(page.locator('.vol-card .perf-delta')).toContainText('+100 %');
    expect(await page.locator('.vol-card .dchart rect').count()).toBeGreaterThan(0);

    await page.locator('.vol-card [data-vol="7"]').click();
    await expect(page.locator('.vol-card .range-opt.on')).toHaveText('7D');
    await expect(page.locator('.vol-card .vol-value')).toContainText('700');
    await expect(page.locator('.vol-card .perf-delta')).toContainText('+133.3 %');
  });

  test('Répartition musculaire : parts réelles calculées depuis le volume', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: [
        sess('h1', daysAgo(2), 'd1', 'A', [ex('Développé couché', [S(60, 8), S(60, 8)])], 960),
        sess('h2', daysAgo(1), 'd1', 'A', [ex('Squat barre', [S(100, 5)])], 500)
      ]
    });
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.musc-card')).toBeVisible();
    await expect(page.locator('.musc-row')).toHaveCount(2);
    await expect(page.locator('.musc-row').first().locator('.musc-label')).toHaveText('Chest');
    await expect(page.locator('.musc-row').first().locator('.musc-pct')).toHaveText('66 %');
    await expect(page.locator('.musc-row').last().locator('.musc-label')).toHaveText('Legs');
    await expect(page.locator('.musc-row').last().locator('.musc-pct')).toHaveText('34 %');
    expect(await page.locator('.musc-track i').first().evaluate(el => el.style.width)).toBe('66%');
  });

  test('le tableau de bord survit à un rechargement', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: growthHistory(),
      prs: { 'développé couché': { name: 'Développé couché', weight: 65, reps: 6, assisted: 0, date: daysAgo(5) } }
    });
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.perf-card .perf-value')).toContainText('78');
    await expect(page.locator('.pr-card')).toHaveCount(1);
    expect((await dbState(page)).history).toBe(2);
  });

  test('terminer une séance écrit prLog et alimente les records', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, { programme: [dayA] });

    await page.click('button[data-tab="seance"]');
    await page.locator('#tab-seance button:has-text("Start")').first().click();
    await page.locator('#activeExercises button:has-text("+ Set")').first().click();
    await page.locator('#addSetModal button:has-text("Save set")').click();
    await page.locator('#activeModal button:has-text("Finish session")').click();

    const s = await dbState(page);
    expect(s.history).toBe(1);
    expect(s.prs).toBe(1);
    expect(s.prLog).toBe(1);

    const log = await page.evaluate(() => DB.prLog[0]);
    expect(log.name).toBe('Développé couché');
    expect(log.date).toBe(today());
    expect(log.prev).toBeNull();

    /* La notification LIFTR affiche un commentaire adapté (nouveau record) */
    await expect(page.locator('#liftrNotif')).toHaveClass(/show/);
    await expect(page.locator('#liftrText')).toHaveAttribute('data-filter', 'NEW_PR');
    await expect(page.locator('#liftrText')).not.toBeEmpty();
    await page.locator('#liftrClose').click();

    await page.click('button[data-tab="stats"]');
    await expect(page.locator('.pr-badge.new')).toHaveText('NEW PR');
    await expect(page.locator('.liftr-note')).toHaveCount(0);
  });

  test('un record battu journalise le record précédent', async ({ page }) => {
    await seed(page, { programme: [dayA] });
    await page.evaluate(() => {
      updatePR('Développé couché', 60, 8, 0);
      updatePR('Développé couché', 65, 6, 0);
      save();
    });
    const log = await page.evaluate(() => DB.prLog);
    expect(log).toHaveLength(2);
    expect(log[0].weight).toBe(65);
    expect(log[0].prev).toEqual({ weight: 60, reps: 8, assisted: 0 });
    expect(log[1].weight).toBe(60);
    expect(log[1].prev).toBeNull();
  });

  test('supprimer un jour purge son prLog', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      prs: { 'développé couché': { name: 'Développé couché', weight: 60, reps: 8, assisted: 0, date: today() } },
      prLog: [{ date: today(), key: 'développé couché', name: 'Développé couché', weight: 60, reps: 8, assisted: 0, prev: null }]
    });
    await page.click('button[data-tab="programme"]');
    await page.locator('#daysList [title="Delete"]').first().click();
    await expect(page.locator('#confirmModal')).toHaveClass(/show/);
    await page.click('#cfOk');

    const s = await dbState(page);
    expect(s.prs).toBe(0);
    expect(s.prLog).toBe(0);
  });

  test('aucune erreur console avec un dashboard complet (4 onglets)', async ({ page }) => {
    const errs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await seed(page, {
      programme: [dayA, dayB],
      history: growthHistory().concat([
        sess('h3', daysAgo(1), 'd2', 'B', [ex('Tractions pronation', [S(0, 8), S(0, 8)])], 0)
      ]),
      prs: { 'développé couché': { name: 'Développé couché', weight: 65, reps: 6, assisted: 0, date: daysAgo(5) } },
      prLog: [{ date: daysAgo(5), key: 'développé couché', name: 'Développé couché', weight: 65, reps: 6, assisted: 0, prev: { weight: 60, reps: 8, assisted: 0 } }],
      weightLog: [{ date: daysAgo(6), kg: 82.4 }, { date: daysAgo(1), kg: 82.1 }]
    });
    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    for (const t of ['programme', 'seance', 'calendrier', 'stats']){
      await page.click(`button[data-tab="${t}"]`);
      await page.waitForTimeout(120);
    }
    expect(errs).toEqual([]);
  });
});
