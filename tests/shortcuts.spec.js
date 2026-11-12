const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

test.describe('LIFTR shortcuts', () => {
  test('keyboard command palette filters and opens the selected route', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.keyboard.press('Control+k');
    await expect(page.locator('#shortcutDialog')).toHaveJSProperty('open', true);
    await page.locator('#shortcutQuery').fill('training progress');
    await expect(page.locator('#shortcutResults .shortcut-option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator('#shortcutDialog')).toHaveJSProperty('open', false);
    await expect(page.locator('#tab-stats')).toBeVisible();
  });

  test('the food diary shortcut opens the existing meal workflow', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.locator('#openShortcutBtn').click();
    await page.locator('#shortcutQuery').fill('food diary');
    await page.locator('#shortcutResults .shortcut-option').click();
    await expect(page.locator('#tab-nutri-meals')).toBeVisible();
    await expect(page.locator('#nutriMeals')).toBeVisible();
    await page.locator('#tab-nutri-meals').getByRole('button', { name: /Meal/ }).click();
    await expect(page.locator('#mealName')).toBeVisible();
  });

  test('Escape closes the palette and focus returns to its launcher', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.locator('#openShortcutBtn').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcutDialog')).toHaveJSProperty('open', false);
    await expect(page.locator('#openShortcutBtn')).toBeFocused();
  });
});
