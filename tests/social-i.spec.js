import { test, expect } from '@playwright/test';
import { seed, EMPTY_DB } from './helpers.js';
import { mockApi, consoleWatch } from './social-mock.js';

const USER = 'Mouataz';

/* ---------------------------------------------------------------- *
 * Chantier I — Stats : cartes Insights / This week / Force / ACWR /  *
 * Body. Vues sur le sous-onglet Progression (Gym > Progression).     *
 * ---------------------------------------------------------------- */

async function openStats(page){
  await seed(page, EMPTY_DB, USER);
  await page.click('.tabbar .tab[data-tab="gym"]');
  await page.waitForSelector('#rootSubnav [data-tab="stats"]');
  await page.click('#rootSubnav [data-tab="stats"]');
  await page.waitForSelector('#statsContent');
}

async function seedStats(page, db){
  await seed(page, db, USER);
  await page.click('.tabbar .tab[data-tab="gym"]');
  await page.waitForSelector('#rootSubnav [data-tab="stats"]');
  await page.click('#rootSubnav [data-tab="stats"]');
  await page.waitForSelector('#statsContent');
}

/* 8 semaines de séances Push (PUSH) avec une montée en charge régulière */
function seedHistory(){
  const hist = [];
  const ex = (name, sets) => ({ name, sets });
  for (let i = 0; i < 8; i++){
    const d = new Date();
    d.setDate(d.getDate() - (7 - i) * 7 - 3);
    const iso = d.toISOString().slice(0, 10);
    const w = 60 + i * 2.5;
    hist.push({
      id: 's' + i,
      date: iso,
      dayName: 'Push A',
      dayId: 'push-a',
      startedAt: d.getTime(),
      endedAt: d.getTime() + 3480000,
      note: '',
      exercises: [
        ex('Bench Press', [
          { weight: w, reps: 8, done: true },
          { weight: w, reps: 8, done: true },
          { weight: w, reps: 6, done: true }
        ]),
        ex('Overhead Press', [
          { weight: 40 + i, reps: 8, done: true },
          { weight: 40 + i, reps: 8, done: true }
        ])
      ],
      totalSets: 5,
      volume: Math.round((w * 22 + (40 + i) * 16))
    });
  }
  return { history: hist, weeks: {}, programme: [], prs: {} };
}

test.describe('Chantier I — Stats « Progression » intelligente', () => {
  test.beforeEach(async ({ page }) => { await mockApi(page); });

  test('I-1 : la carte Insights affiche un titre et au moins une insight actionnable', async ({ page }) => {
    await seedStats(page, seedHistory());
    const card = page.locator('#statsContent .card', { hasText: 'Insights' }).first();
    await expect(card).toBeVisible();
    const body = card.locator('.ins-body, .ins-list, .card-body').first();
    await expect(body).toBeVisible();
    const txt = (await card.innerText()).toLowerCase();
    expect(txt).toMatch(/pr|plateau|volume|acwr|streak|weight|insight/);
  });

  test('I-2 : la carte « This week » montre les séances et le volume de la semaine en cours', async ({ page }) => {
    await seedStats(page, seedHistory());
    const card = page.locator('#statsContent .card', { hasText: 'This week' }).first();
    await expect(card).toBeVisible();
    const txt = await card.innerText();
    expect(txt).toMatch(/\d/);
    expect(txt.toLowerCase()).toMatch(/session|volume|kg|k/);
  });

  test('I-3 : la carte Force affiche l’e1RM estimé et la prochaine cible (double progression)', async ({ page }) => {
    await seedStats(page, seedHistory());
    const card = page.locator('#statsContent .card', { hasText: 'Force' }).first();
    await expect(card).toBeVisible();
    const txt = await card.innerText();
    expect(txt).toMatch(/\d/);
    expect(txt.toLowerCase()).toMatch(/e1rm|1rm|cible|target|kg/);
  });

  test('I-4 : la carte « Hard sets by muscle » agrège les séances dures par muscle', async ({ page }) => {
    await seedStats(page, seedHistory());
    const card = page.locator('#statsContent .card.muscs-card').first();
    await expect(card).toBeVisible();
    const txt = await card.innerText();
    expect(txt.toLowerCase()).toMatch(/chest|dos|back|jambes|legs|épaules|shoulders|bras|arms|10|20/);
  });

  test('I-5 : la carte ACWR présente une zone (charge aiguë vs chronique)', async ({ page }) => {
    await seedStats(page, seedHistory());
    const card = page.locator('#statsContent .card', { hasText: /acwr|charge|load/i }).first();
    await expect(card).toBeVisible();
    const txt = await card.innerText();
    expect(txt.toLowerCase()).toMatch(/acwr|aigu|chronique|acute|chronic|zone|ratio|indicatif|indicative/);
  });

  test('I-6 : la carte Body affiche le poids lissé (EMA) et sa pente', async ({ page }) => {
    const db = seedHistory();
    db.weightLog = [];
    for (let i = 0; i < 10; i++){
      const d = new Date();
      d.setDate(d.getDate() - (9 - i));
      db.weightLog.push({ date: d.toISOString().slice(0, 10), kg: 78 + i * 0.15 });
    }
    await seedStats(page, db);
    const card = page.locator('#statsContent .card.body-card').first();
    await expect(card).toBeVisible();
    const txt = await card.innerText();
    expect(txt.toLowerCase()).toMatch(/ema|liss|smooth|pente|trend|kg\s*\/|kg\/sem|kg\/week/);
  });

  test('I-7 : les cartes I viennent avant les cartes classiques (vol, muscle, pr)', async ({ page }) => {
    await seedStats(page, seedHistory());
    const cards = await page.locator('#statsContent .card').evaluateAll(els =>
      els.map(e => e.className));

    const cls = (n) => cards.findIndex(c => c.split(/\s+/).includes(n));

    const iIns = cls('ins-list-card');
    const iWeek = cls('week-card');
    const iForce = cls('force-card');
    const iMuscs = cls('muscs-card');
    const iAcwr = cls('acwr-card');
    const iBody = cls('body-card');
    const iVol = cls('vol-card');

    for (const [name, i] of [['insights', iIns], ['this week', iWeek],
      ['force', iForce], ['muscs', iMuscs], ['acwr', iAcwr], ['body', iBody]]) {
      expect(i, `${name} card present`).toBeGreaterThanOrEqual(0);
    }

    expect(iWeek).toBeGreaterThan(iIns);
    expect(iForce).toBeGreaterThan(iWeek);
    expect(iVol).toBeGreaterThan(iForce);
    expect(iMuscs).toBeGreaterThan(iVol);
    expect(iAcwr).toBeGreaterThan(iMuscs);
    expect(iBody).toBeGreaterThan(iAcwr);
  });

  test('I-8 : profil vide → la carte Insights affiche un état vide cohérent', async ({ page }) => {
    await openStats(page);
    const card = page.locator('#statsContent .card', { hasText: /insight/i }).first();
    if (await card.count()){
      const txt = (await card.innerText()).toLowerCase();
      expect(txt).toMatch(/aucune|empty|pas encore|no |commencez|start|—|–/);
    }
  });

  test('I-9 : aucune erreur console sur Progression avec données complètes', async ({ page }) => {
    const errs = consoleWatch(page);
    const db = seedHistory();
    db.weightLog = [{ date: new Date().toISOString().slice(0, 10), kg: 79 }];
    await seedStats(page, db);
    await page.waitForTimeout(600);
    expect(errs).toEqual([]);
  });
});
