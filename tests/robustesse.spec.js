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
});
