const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { seed } = require('./helpers');

async function openNutrition(page, tab = 'nutri-today'){
  await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
  if (tab !== 'nutri-today') await page.locator('#rootSubnav [data-tab="' + tab + '"]').click();
}

test.describe('Améliorations choisies', () => {
  test('préférences personnalisées, langue française et guide', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => openAppPreferences());
    await expect(page.locator('#liftrPreferences')).toHaveClass(/show/);
    await page.locator('#prefLanguage').selectOption('fr');
    await page.locator('#prefTextSize').selectOption('xlarge');
    await page.locator('#prefReducedMotion').check();
    await page.locator('#prefQuotes').uncheck();
    await page.locator('[name="liftrShortcut"][value="social"]').uncheck();
    await page.evaluate(() => saveAppPreferences());

    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('data-text-size', 'xlarge');
    await expect(page.locator('html')).toHaveClass(/liftr-reduce-motion/);
    await expect(page.locator('html')).toHaveClass(/liftr-quotes-off/);
    await expect(page.locator('#todayShortcutsTitle')).toHaveText('Actions rapides');
    await expect(page.locator('#todaySessionCount')).toHaveText('Prêt quand tu veux');
    await expect(page.locator('#todayDate')).not.toContainText(/MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY/);
    const shortcuts = await page.evaluate(() => JSON.parse(localStorage.getItem('liftr_shortcuts_Mouataz')));
    expect(shortcuts).not.toContain('social');
    await page.evaluate(() => window.setSocialNotificationPreference('comment', false));
    const notifications = await page.evaluate(() => JSON.parse(localStorage.getItem('liftr_social_notifications_guest')));
    expect(notifications.comment).toBe(false);

    await page.evaluate(() => openGettingStartedHelp());
    await expect(page.locator('.first-help')).toContainText('Gym, Nutrition et Social');
    await expect(page.locator('.first-help')).toContainText('Ouvrir Gym');
  });

  test('aliments personnels, portions, recette, courses, repas habituel et sauvegarde restent locaux hors ligne', async ({ page }) => {
    await seed(page, { nutri: {
      goal:{kcal:2200,p:150,c:240,f:70},
      foods:[
        {id:'rice',name:'Rice',source:'custom',kcal:130,protein:2.7,carbs:28,fat:0.3},
        {id:'oats',name:'Oats',source:'custom',kcal:380,protein:13,carbs:66,fat:7}
      ],
      meals:[],recipes:[],favs:[],recents:[],groceries:[],mealShortcuts:[]
    } });
    await openNutrition(page, 'nutri-foods');
    await page.context().setOffline(true);

    await page.locator('#nutriFoods .food-item:has-text("Rice")').first().click();
    await page.locator('#foodDetailModal .fdetail button:has-text("Edit")').click();
    await page.locator('#foodKcal').fill('132');
    await page.locator('#nutriDialogMount button[onclick="submitFood()"]:visible').click();
    await page.locator('#nutriFoods .food-item:has-text("Rice")').first().click();
    await page.locator('#foodDetailModal .fdetail button:has-text("Duplicate")').click();
    await page.locator('#foodName').fill('Rice snack');
    await page.locator('#nutriDialogMount button[onclick="submitFood()"]:visible').click();
    let foods = await page.evaluate(() => DB.nutri.foods);
    expect(foods.find(x => x.id === 'rice').kcal).toBe(132);
    expect(foods.some(x => x.name === 'Rice snack')).toBe(true);

    await page.evaluate(() => openGroceryList());
    await page.locator('#groceryName').fill('Oats');
    await page.locator('#groceryQty').fill('1 bag');
    await page.locator('.grocery-add button').click();
    await page.locator('.grocery-item input[type="checkbox"]').check();
    expect(await page.evaluate(() => DB.nutri.groceries[0].done)).toBe(true);

    await page.evaluate(() => addRecipe());
    await page.locator('#mealName').fill('Oat bowl');
    await page.locator('#mealFoodSearch').fill('Oats');
    await page.locator('#nutriDialogMount .food-pick').first().click();
    await page.locator('#nutriDialogMount .usual-portions button').filter({hasText:'150 g'}).click();
    await expect(page.locator('#itemQty')).toHaveValue('150');
    await page.locator('#nutriDialogMount .item-editor button.btn-primary').click();
    await page.locator('#recipeServings').fill('2');
    await page.locator('#nutriDialogMount button:has-text("Save recipe")').click();
    let recipe = await page.evaluate(() => DB.nutri.recipes.find(x => x.name === 'Oat bowl'));
    expect(recipe.servings).toBe(2);
    expect(recipe.items[0].qty).toBe(150);

    await page.locator('#nutriFoods .recipe-row [aria-label="Edit recipe"]').click();
    await page.locator('#recipeServings').fill('3');
    await page.locator('#nutriDialogMount button:has-text("Save recipe")').click();
    recipe = await page.evaluate(() => DB.nutri.recipes.find(x => x.name === 'Oat bowl'));
    expect(recipe.servings).toBe(3);
    await expect(page.locator('#nutriFoods .recipe-row:has-text("Oat bowl")')).toContainText('lot:');
    await expect(page.locator('#nutriFoods .recipe-row:has-text("Oat bowl")')).toContainText('portion:');

    await page.evaluate(id => useRecipe(id), recipe.id);
    await page.locator('#nutriDialogMount button:has-text("Save meal")').click();
    await page.locator('#nutriMeals [aria-label="Save meal shortcut"]').click();
    expect(await page.evaluate(() => DB.nutri.mealShortcuts.some(x => x.name === 'Oat bowl'))).toBe(true);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => exportNutritionBackup())
    ]);
    expect(download.suggestedFilename()).toMatch(/^liftr-nutrition-.*\.json$/);
    const payload = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(payload.app).toBe('liftr-nutrition-backup');
    expect(payload.nutrition.groceries[0].done).toBe(true);
    expect(payload.nutrition.recipes[0].servings).toBe(3);
    await page.locator('#nutritionBackupFile').setInputFiles({
      name:'liftr-nutrition-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))
    });
    await expect(page.locator('#confirmModal')).toHaveClass(/show/);
    await page.locator('#cfOk').click();
    await expect(page.locator('#toast')).toContainText('Nutrition backup restored');
    expect(await page.evaluate(() => DB.nutri.recipes[0].servings)).toBe(3);
    await page.context().setOffline(false);
  });
});
