const { test, expect } = require('@playwright/test');
const { seed, today } = require('./helpers');

test.describe('Today — tableau de bord local', () => {
  test('résume les données locales et continue à fonctionner hors ligne', async ({ page, context }) => {
    const date = today();
    await seed(page, {
      history: [{ id: 'h-today', date, dayName: 'Push', exercises: [], totalSets: 0, volume: 0 }],
      nutri: {
        goal: { kcal: 2000, p: 140, c: 220, f: 65 },
        meals: [{ id: 'meal-today', date, name: 'Lunch', items: [{ name: 'Rice and eggs', kcal: 650, p: 32, c: 76, f: 22 }] }],
        foods: [], water: { [date]: 500 }, profile: { waterGoalMl: 2000 }
      }
    }, 'Mouataz');

    await page.evaluate(() => showRoot('today'));
    await expect(page.locator('#tab-today')).toBeVisible();
    await expect(page.locator('#todayName')).toHaveText('Mouataz');
    await expect(page.locator('#todayNutritionSummary')).toContainText('650');
    await expect(page.locator('#todayNutritionSummary')).toContainText('32');
    await expect(page.locator('#todayWaterSummary')).toContainText('500');
    await expect(page.locator('#todaySessionCount')).toContainText('1 workout completed today');

    await context.setOffline(true);
    await page.locator('.today-water-panel button').click();
    await expect(page.locator('#todayWaterSummary')).toContainText('750');
    expect(await page.evaluate(() => DB.nutri.water[todayISO()])).toBe(750);
    await expect(page.locator('#tabFeedBtn')).toBeVisible();
    await page.locator('#tabFeedBtn').click();
    await expect(page.locator('#toast')).toContainText('go online');
    await expect(page.locator('#tab-today')).toBeVisible();
    await context.setOffline(false);
  });

  test('le raccourci Nutrition ouvre le journal puis sa feuille d’ajout', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.evaluate(() => showRoot('today'));
    await page.locator('.today-action').filter({ hasText: 'Log food' }).click();
    await expect(page.locator('#tab-nutri-meals')).toBeVisible();
    await page.locator('#tab-nutri-meals').getByRole('button', { name: /Meal/ }).click();
    await expect(page.locator('#mealName')).toBeVisible();
  });

  test('sur ordinateur, la navigation devient une barre latérale et le contenu s’élargit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, {}, 'Mouataz');
    await page.evaluate(() => showRoot('today'));
    const layout = await page.evaluate(() => {
      const nav = document.querySelector('.tabbar').getBoundingClientRect();
      const app = document.querySelector('.app').getBoundingClientRect();
      return { navLeft: nav.left, navWidth: nav.width, appLeft: app.left, appWidth: app.width };
    });
    expect(layout.navLeft).toBe(0);
    expect(layout.navWidth).toBeGreaterThan(180);
    expect(layout.appLeft).toBeGreaterThanOrEqual(layout.navWidth);
    expect(layout.appWidth).toBeGreaterThan(900);
  });
});
