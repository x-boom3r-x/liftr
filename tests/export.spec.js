const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { seed, today, daysAgo } = require('./helpers');

const histRecent = {
  id: 'h1', date: daysAgo(2), dayId: 'd1', dayName: 'PUSH', note: '',
  exercises: [{ id: 'e1', name: 'Développé couché', sets: [
    { weight: 60, reps: 8, assisted: 0 },
    { weight: 60, reps: 8, assisted: 0 }
  ] }],
  totalSets: 2, volume: 960, performed: 1
};
const histOld = {
  id: 'h2', date: daysAgo(40), dayId: 'd1', dayName: 'PUSH', note: 'ancienne',
  exercises: [{ id: 'e1', name: 'Développé couché', sets: [{ weight: 55, reps: 8, assisted: 0 }] }],
  totalSets: 1, volume: 440, performed: 1
};
const histCardio = {
  id: 'h3', date: daysAgo(1), dayId: 'dc', dayName: 'CARDIO', note: '',
  exercises: [{ id: 'ec', name: 'Tapis de course', cardio: true, sets: [{ cardio: true, min: 30, km: 5 }] }],
  totalSets: 1, volume: 0, performed: 1, cardioMin: 30, cardioKm: 5
};

const SEED = {
  programme: [{ id: 'd1', name: 'PUSH', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] },
              { id: 'dc', name: 'CARDIO', type: 'CARDIO', exercises: [{ id: 'ec', name: 'Tapis de course', cardio: true }] }],
  history: [histRecent, histOld, histCardio],
  prLog: [{ date: daysAgo(3), key: 'développé couché', name: 'Développé couché', weight: 65, reps: 5, assisted: 0, prev: 60 }],
  progressions: [{ id: 'p1', date: daysAgo(2), exercise: 'Squat barre', weight: 80, reps: 5, assisted: 0, note: 'plus lourd' }],
  weightLog: [{ date: daysAgo(6), kg: 82.5 }, { date: daysAgo(1), kg: 81.9 }]
};

async function openExport(page){
  await page.click('button[data-tab="stats"]');
  await page.locator('#tab-stats button:has-text("Export")').click();
  await expect(page.locator('#exportModal')).toHaveClass(/show/);
}

test.describe('Export CSV par intervalle', () => {

  test('la modale s’ouvre avec l’aperçu du preset 7 jours', async ({ page }) => {
    await seed(page, SEED, 'Mouataz');
    await openExport(page);

    await expect(page.locator('#exportPreview')).toContainText('Preview');
    await expect(page.locator('#exportPreview')).toContainText('Sessions');
    await expect(page.locator('#exportModal .type-opt.on')).toHaveText('7 days');
    await expect(page.locator('#exportCustom')).toBeHidden();

    /* sur 7 j : j-1 (cardio) + j-2 (push) — la séance du jour -40 est hors période */
    const counts = await page.locator('#exportPreview .ep-row').allTextContents();
    const seances = counts.find(c => c.startsWith('Sessions'));
    expect(seances).toBe('Sessions2');
  });

  test('changer de preset recalcule l’aperçu (30 j vs Tout)', async ({ page }) => {
    await seed(page, SEED, 'Mouataz');
    await openExport(page);

    await page.locator('#exportModal button:has-text("30 days")').click();
    await expect(page.locator('#exportModal .type-opt.on')).toHaveText('30 days');
    let rows = await page.locator('#exportPreview .ep-row').allTextContents();
    expect(rows.find(c => c.startsWith('Sessions'))).toBe('Sessions2');

    await page.locator('#exportModal button:has-text("All")').click();
    rows = await page.locator('#exportPreview .ep-row').allTextContents();
    expect(rows.find(c => c.startsWith('Sessions'))).toBe('Sessions3');
    expect(rows.find(c => c.startsWith('Records'))).toBe('Records1');
    expect(rows.find(c => c.startsWith('Weigh-ins'))).toBe('Weigh-ins2');
  });

  test('le mode personnalisé affiche les 2 date inputs bornés', async ({ page }) => {
    await seed(page, SEED, 'Mouataz');
    await openExport(page);

    await page.locator('#exportModal button:has-text("Custom")').click();
    await expect(page.locator('#exportCustom')).toBeVisible();
    const from = await page.inputValue('#expFrom');
    const to = await page.inputValue('#expTo');
    expect(from).toBe(daysAgo(29));
    expect(to).toBe(today());

    await page.fill('#expFrom', daysAgo(50));
    await page.fill('#expTo', daysAgo(35));
    const rows = await page.locator('#exportPreview .ep-row').allTextContents();
    expect(rows.find(c => c.startsWith('Sessions'))).toBe('Sessions1');
  });

  test('le téléchargement produit un CSV complet et lisible', async ({ page }) => {
    await seed(page, SEED, 'Mouataz');
    await openExport(page);
    await page.locator('#exportModal button:has-text("All")').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#exportModal button:has-text("Download CSV")').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/^liftr-stats_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);

    const path = await download.path();
    const raw = fs.readFileSync(path, 'utf8');
    expect(raw.charCodeAt(0)).toBe(0xFEFF); /* BOM pour Excel */
    const csv = raw.slice(1);
    expect(csv).toContain('LIFTR - EXPORT');
    expect(csv).toContain('SUMMARY');
    expect(csv).toContain('SESSIONS');
    expect(csv).toContain('SETS');
    expect(csv).toContain('RECORDS');
    expect(csv).toContain('WEIGHT');
    expect(csv).toContain('PROGRESSIONS');
    expect(csv).toContain('Total volume (kg);1400');
    expect(csv).toContain('Cardio (km);5');
    expect(csv).toContain('Cardio lines;1');
    expect(csv).toContain('82.5');
    expect(csv).toContain(histOld.date);          /* séance il y a 40 j incluse en Tout */
    expect(csv).toContain('Développé couché;STRENGTH');
    expect(csv).toContain('Tapis de course;CARDIO');
    expect(csv).toContain('30 min · 5 km');
    expect(csv).toContain('Squat barre');

    await expect(page.locator('#toast')).toContainText('CSV downloaded');
    await expect(page.locator('#exportModal')).not.toHaveClass(/show/);
  });

  test('buildStatsCSV filtre correctement par intervalle', async ({ page }) => {
    await seed(page, SEED, 'Mouataz');
    const out = await page.evaluate(() => {
      const ago = n => {
        const d = new Date(); d.setDate(d.getDate() - n);
        const p = x => String(x).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      };
      const week = buildStatsCSV(ago(7), todayISO());
      const all = buildStatsCSV('0000-01-01', todayISO());
      return {
        weekHasRecent: week.includes(ago(2)),
        weekHasOld: week.includes(ago(40)),
        allHasOld: all.includes(ago(40)),
        weekSections: ['SUMMARY', 'SETS', 'RECORDS', 'WEIGHT', 'PROGRESSIONS'].every(s => week.includes(s)),
        weekSummary: week.includes('Sessions;2') /* j-1 et j-2 seulement */
      };
    });
    expect(out.weekHasRecent).toBe(true);
    expect(out.weekHasOld).toBe(false);
    expect(out.allHasOld).toBe(true);
    expect(out.weekSections).toBe(true);
    expect(out.weekSummary).toBe(true);
  });

  test('sans donnée : toast, pas de modale', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.click('button[data-tab="stats"]');
    await page.locator('#tab-stats button:has-text("Export")').click();

    await expect(page.locator('#exportModal')).not.toHaveClass(/show/);
    await expect(page.locator('#toast')).toContainText('No data');
  });

  test('aucune erreur console autour de l’export', async ({ page }) => {
    const errs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await seed(page, SEED, 'Mouataz');
    await openExport(page);
    await page.locator('#exportModal button:has-text("7 days")').click();
    await page.locator('#exportModal button:has-text("Cancel")').click();
    await page.click('button[data-tab="calendrier"]');
    await page.waitForTimeout(150);
    expect(errs).toEqual([]);
  });
});
