const { test, expect } = require('@playwright/test');
const { seed, dbState, today, daysAgo } = require('./helpers');

const noter = page => page.locator('.weight-card button.btn-primary');

test.describe('Body weight', () => {

  test('la carte poids apparaît dans les stats', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('#statsContent .weight-card')).toBeVisible();
    await expect(page.locator('.weight-card .card-title')).toContainText('Body weight');
    await expect(page.locator('#weightInputVal')).toBeVisible();
    await expect(page.locator('.weight-card .stepper')).toBeVisible();
    await expect(noter(page)).toBeVisible();
    await expect(noter(page)).toHaveText('Log');
    await expect(page.locator('.weight-val.dim')).toHaveText('—');
    await expect(page.locator('.w-today.todo')).toBeVisible();
    await expect(page.locator('.w-today')).toContainText('First weigh-in of the day');
  });

  test('noter un poids le sauvegarde et l’affiche', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    await page.fill('#weightInputVal', '82.4');
    await noter(page).click();

    await expect(page.locator('#toast')).toContainText("Today's weight logged");
    const w = await page.evaluate(() => DB.weightLog);
    expect(w).toEqual([{ date: today(), kg: 82.4 }]);
    await expect(page.locator('.weight-val')).toContainText('82.4');
    await expect(page.locator('.w-today.ok')).toBeVisible();
    await expect(page.locator('.w-today')).toContainText("Today's weigh-in · 82.4 kg");
    await expect(noter(page)).toHaveText('Update');
  });

  test('le stepper ±0,1 ajuste vite sans clavier, puis Noter enregistre', async ({ page }) => {
    await seed(page, { weightLog: [{ date: daysAgo(1), kg: 82 }] }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    /* pré-rempli avec le dernier poids connu */
    await expect(page.locator('#weightInputVal')).toHaveValue('82');

    await page.locator('.weight-card .stepper button').last().click();   /* +0,1 */
    await expect(page.locator('#weightInputVal')).toHaveValue('82.1');
    await page.locator('.weight-card .stepper button').first().click();  /* -0,1 */
    await page.locator('.weight-card .stepper button').first().click();  /* -0,1 */
    await expect(page.locator('#weightInputVal')).toHaveValue('81.9');

    await noter(page).click();
    expect(await page.evaluate(() => DB.weightLog[0])).toEqual({ date: today(), kg: 81.9 });
    await expect(page.locator('#toast')).toContainText("Today's weight logged");
  });

  test('l’état du jour et la série passent de ⏳ à ✓', async ({ page }) => {
    await seed(page, {
      weightLog: [
        { date: daysAgo(3), kg: 83 },
        { date: daysAgo(2), kg: 82.7 },
        { date: daysAgo(1), kg: 82.5 }
      ]
    }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    const badge = page.locator('.w-today');
    await expect(badge).toHaveClass(/todo/);
    await expect(badge).toContainText("Today's weigh-in due");
    await expect(page.locator('.w-streak')).toContainText('3 days');
    expect(await page.evaluate(() => weightStreak())).toBe(3);

    await noter(page).click();

    await expect(badge).toHaveClass(/ok/);
    await expect(badge).toContainText("Today's weigh-in ·");
    await expect(page.locator('.w-streak')).toContainText('4 days');
    expect(await page.evaluate(() => weightStreak())).toBe(4);
    expect(await page.evaluate(() => weightTodayKg())).toBe(82.5);
    await expect(page.locator('#toast')).toContainText('4 days');
  });

  test('la variation s’affiche entre deux pesées', async ({ page }) => {
    await seed(page, {
      weightLog: [
        { date: daysAgo(4), kg: 80 },
        { date: daysAgo(2), kg: 80.6 },
        { date: today(), kg: 81.8 }
      ]
    }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.weight-val')).toContainText('81.8');
    const delta = page.locator('.weight-delta');
    await expect(delta).toBeVisible();
    await expect(delta).toContainText('+1.2 kg');
    await expect(delta).toHaveClass(/up/);
  });

  test('la sparkline trace les pesées de la période', async ({ page }) => {
    await seed(page, {
      weightLog: [
        { date: daysAgo(10), kg: 83 },
        { date: daysAgo(5), kg: 82.4 },
        { date: today(), kg: 82 }
      ]
    }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.weight-card svg.spark')).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll('.weight-card svg.spark polyline').length)).toBe(1);
    const pts = await page.evaluate(() => document.querySelector('.weight-card svg.spark polyline').getAttribute('points'));
    expect(pts.split(' ').length).toBe(3);

    await page.locator('.weight-card .range-opt:has-text("1y")').click();
    await expect(page.locator('.weight-card .range-opt.on')).toHaveText('1y');
    await expect(page.locator('.weight-card svg.spark')).toBeVisible();
  });

  test('un poids hors bornes est refusé avec un toast', async ({ page }) => {
    await seed(page, { weightLog: [{ date: today(), kg: 80 }] }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    await page.fill('#weightInputVal', '5');
    await noter(page).click();

    await expect(page.locator('#toast')).toContainText('20 and 300');
    expect(await page.evaluate(() => DB.weightLog)).toEqual([{ date: today(), kg: 80 }]);
  });

  test('une seconde pesée le même jour remplace la première', async ({ page }) => {
    await seed(page, { weightLog: [{ date: today(), kg: 80 }] }, 'Mouataz');
    await page.click('button[data-tab="stats"]');

    await expect(noter(page)).toHaveText('Update');
    await page.fill('#weightInputVal', '80.6');
    await noter(page).click();

    const w = await page.evaluate(() => DB.weightLog);
    expect(w).toHaveLength(1);
    expect(w[0]).toEqual({ date: today(), kg: 80.6 });
    await expect(page.locator('.weight-val')).toContainText('80.6');
    await expect(page.locator('.weight-delta')).toHaveCount(0); /* pas de delta avec une seule pesée */
    await expect(page.locator('#toast')).toContainText('weigh-in updated');
  });

  test('la pesée survit à un rechargement (miroir + IDB)', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.click('button[data-tab="stats"]');
    await page.fill('#weightInputVal', '79.5');
    await noter(page).click();

    await page.reload();
    await page.waitForSelector('#mainApp:not(.hidden)');
    await page.click('button[data-tab="stats"]');

    await expect(page.locator('.weight-val')).toContainText('79.5');
    await expect(page.locator('.w-today.ok')).toBeVisible();
    expect(await dbState(page)).toMatchObject({ currentUser: 'Mouataz' });
  });
});
