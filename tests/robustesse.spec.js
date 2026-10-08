const { test, expect } = require('@playwright/test');
const { seed, dbState, daysAgo } = require('./helpers');
const fs = require('fs');

const dayA = { id: 'd1', name: 'PUSH', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };
const dayB = { id: 'd2', name: 'LEGS', type: 'LEGS', exercises: [{ id: 'e2', name: 'Squat barre' }] };

test.describe('Robustesse', () => {

  test('l\'export de sauvegarde contient tout le profil', async ({ page }) => {
    await seed(page, {
      programme: [dayA],
      history: [{ id: 'h1', date: daysAgo(1), dayId: 'd1', dayName: 'PUSH', exercises: [], totalSets: 4, volume: 700, note: 'ok' }],
      prs: { 'développé couché': { name: 'Développé couché', weight: 70, reps: 5, assisted: 0, date: daysAgo(1) } }
    }, 'Mouataz');

    await page.click('button[data-tab="programme"]');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("Export (.json)")').click()
    ]);
    expect(dl.suggestedFilename()).toContain('liftr-backup-mouataz');

    const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    expect(json.app).toBe('liftr-backup');
    expect(json.profile).toBe('Mouataz');
    expect(json.db.programme.length).toBe(1);
    expect(json.db.history.length).toBe(1);
    expect(json.db.history[0].volume).toBe(700);
    expect(json.db.prs['développé couché'].weight).toBe(70);
    expect(typeof json.db.weeks).toBe('object');
  });

  test('restaurer une sauvegarde remplace les données du profil', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    const backup = {
      app: 'liftr-backup', v: 1, profile: 'Mouataz', at: new Date().toISOString(),
      db: {
        programme: [dayA, dayB], history: [
          { id: 'hx', date: daysAgo(2), dayId: 'd2', dayName: 'LEGS', exercises: [], totalSets: 8, volume: 2000, note: '' }
        ],
        progressions: [], weeks: {}, prs: {}, prLog: [], custom: [], active: null
      }
    };
    await page.click('button[data-tab="programme"]');
    await page.setInputFiles('#backupFile', {
      name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))
    });
    await expect(page.locator('#confirmModal')).toHaveClass(/show/);
    await expect(page.locator('#cfMsg')).toContainText('2 day(s)');
    await page.locator('#cfOk').click();

    const s = await dbState(page);
    expect(s.programme).toBe(2);
    expect(s.history).toBe(1);
    expect(await page.evaluate(() => DB.history[0].dayName)).toBe('LEGS');
    await expect(page.locator('#toast')).toContainText('Backup restored');

    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    expect((await dbState(page)).programme).toBe(2);
  });

  test('un fichier de sauvegarde invalide est refusé sans toucher aux données', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.click('button[data-tab="programme"]');
    await page.setInputFiles('#backupFile', {
      name: 'fake.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}')
    });
    await expect(page.locator('#toast')).toContainText('Invalid');
    await expect(page.locator('#confirmModal')).not.toHaveClass(/show/);
    expect((await dbState(page)).programme).toBe(1);
  });

  test('un JSON corrompu est refusé', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.click('button[data-tab="programme"]');
    await page.setInputFiles('#backupFile', {
      name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{pas du json')
    });
    await expect(page.locator('#toast')).toContainText('Invalid');
    expect((await dbState(page)).programme).toBe(1);
  });

  test('quota localStorage plein : toast « Stockage plein »', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.evaluate(() => {
      Storage.prototype.setItem = function(){
        const e = new Error('quota exceeded');
        e.name = 'QuotaExceededError';
        throw e;
      };
      save();
    });
    await expect(page.locator('#toast')).toContainText('Storage full');
    expect((await dbState(page)).programme).toBe(1);
  });

  test('une exception globale affiche le toast d\'avertissement', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.evaluate(() => {
      setTimeout(() => { throw new Error('boom-robustesse'); }, 0);
    });
    await expect(page.locator('#toast')).toContainText('internal error');
    await expect(page.locator('#mainApp')).toBeVisible();
  });

  /* iOS Safari : un scroll programmaté au changement d'onglet fait réapparaître
     la barre du navigateur. Le document ne défile plus (app shell : c'est .app
     qui défile) — on vérifie qu'aucun scroll n'est forcé et que la tabbar ne
     bouge pas d'un pixel. */
  test('changement d\'onglet : aucun scroll forcé, la tabbar ne bouge pas', async ({ page }) => {
    const history = [];
    for (let i = 0; i < 12; i++){
      history.push({ id: 'h' + i, date: daysAgo(i * 3 + 1), dayId: 'd1', dayName: 'PUSH',
        exercises: [{ id: 'e1', name: 'Développé couché', sets: [{ weight: 60, reps: 8 }] }],
        totalSets: 1, volume: 480, note: '' });
    }
    const programme = [];
    for (let d = 0; d < 10; d++){
      programme.push({ id: 'p' + d, name: 'Jour ' + (d + 1) + ' — poussée et jambes', type: d % 2 ? 'LEGS' : 'PUSH',
        exercises: [{ id: 'e' + d, name: 'Exercice ' + (d + 1) }] });
    }
    await seed(page, { programme, history }, 'Mouataz');

    await page.evaluate(() => { document.querySelector('.app').scrollTop = 40; });
    await page.waitForFunction(() => document.querySelector('.app').scrollTop >= 40);
    const snap = () => page.evaluate(() => {
      const sc = document.querySelector('.app');
      return {
        y: sc.scrollTop,
        top: Math.round(document.querySelector('.tabbar').getBoundingClientRect().top),
        docH: sc.scrollHeight
      };
    });
    const before = await snap();
    expect(before.y).toBeGreaterThanOrEqual(40);

    await page.evaluate(() => window.showTab('stats'));
    await page.waitForTimeout(250);
    const stats = await snap();
    expect(stats.docH).toBeGreaterThan(stats.y + 100); /* pas de clamp : onglet plus haut que la position */
    expect(stats.y).toBe(before.y);                    /* aucun scroll programmaté */
    expect(stats.top).toBe(before.top);                /* la tabbar ne bouge pas d'un pixel */

    await page.evaluate(() => window.showTab('programme'));
    await page.waitForTimeout(250);
    const back = await snap();
    expect(back.y).toBe(before.y);
    expect(back.top).toBe(before.top);
    expect(await page.evaluate(() => window.scrollY)).toBe(0); /* le document ne défile plus */
  });
});
