const { test, expect } = require('@playwright/test');
const { seed, dbState } = require('./helpers');

const dayA = { id: 'd1', name: 'A', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }, { id: 'e2', name: 'Pompes' }] };
const dayB = { id: 'd2', name: 'B', type: 'PULL', exercises: [{ id: 'e3', name: 'Tractions' }] };

test.describe('Partage de programme', () => {

  test('génération du code + import chez l\'autre profil', async ({ page }) => {
    await seed(page, { programme: [dayA, dayB], custom: ['Exo perso'] }, 'Mouataz');

    await page.locator('button:has-text("Share")').first().click();
    await expect(page.locator('#shareModal')).toHaveClass(/show/);
    await expect(page.locator('#shareSummary')).toContainText('Mouataz');
    const code = await page.locator('#shareCode').inputValue();
    expect(code.length).toBeGreaterThan(50);
    await page.click('button:has-text("Close")');

    // deuxième appareil / deuxième profil
    await seed(page, {}, 'Riad');
    await page.locator('button:has-text("Import")').first().click();
    await page.locator('#importCode').fill(code);
    await expect(page.locator('#importHint')).toContainText('Valid code');
    await expect(page.locator('#importPreview')).toContainText('Mouataz');
    await page.locator('#importBtn').click();

    const s = await dbState(page);
    expect(s.programme).toBe(2);
    expect(s.custom).toBe(1);

    const names = await page.evaluate(() => DB.programme.map(d => d.name).sort());
    expect(names).toEqual(['A', 'B']);
  });

  test('réimport : les doublons sont ignorés (mode fusion)', async ({ page }) => {
    await seed(page, { programme: [dayA, dayB] }, 'Mouataz');
    await page.locator('button:has-text("Share")').first().click();
    const code = await page.locator('#shareCode').inputValue();
    await page.click('button:has-text("Close")');

    await seed(page, {}, 'Riad');
    await page.locator('button:has-text("Import")').first().click();
    await page.locator('#importCode').fill(code);
    await page.locator('#importBtn').click();
    expect((await dbState(page)).programme).toBe(2);

    await page.locator('button:has-text("Import")').first().click();
    await page.locator('#importCode').fill(code);
    await expect(page.locator('#importHint')).toContainText('Valid code');
    await expect(page.locator('#importPreview')).toContainText('your program has 2 day');
    await page.locator('#importBtn').click();
    expect((await dbState(page)).programme).toBe(2);
  });

  test('le lien ?share= ouvre l\'import automatiquement', async ({ page }) => {
    await seed(page, { programme: [dayA] }, 'Mouataz');
    await page.locator('button:has-text("Share")').first().click();
    const code = await page.locator('#shareCode').inputValue();
    const link = await page.locator('#shareLink').inputValue();
    expect(link).toContain('?share=');

    await seed(page, {}, 'Riad');
    await page.goto('/index.html?share=' + encodeURIComponent(code));
    await page.waitForSelector('#mainApp:not(.hidden)');
    await expect(page.locator('#importModal')).toHaveClass(/show/, { timeout: 5000 });
    await expect(page.locator('#importHint')).toContainText('Valid code');
    await page.locator('#importBtn').click();
    expect((await dbState(page)).programme).toBe(1);
    await expect(page).toHaveURL(/index\.html$/);
  });

  test('code invalide refusé', async ({ page }) => {
    await seed(page, {}, 'Riad');
    await page.locator('button:has-text("Import")').first().click();
    await page.locator('#importCode').fill('ceci n est pas un code');
    await expect(page.locator('#importHint')).toContainText('Invalid');
    await expect(page.locator('#importBtn')).toBeDisabled();
  });

  test('un programme vide ne produit pas de code', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.locator('button:has-text("Share")').first().click();
    await expect(page.locator('#shareSummary')).toContainText('empty');
    await expect(page.locator('#shareCode')).toHaveValue('');
  });
});
