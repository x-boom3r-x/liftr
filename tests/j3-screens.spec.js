/* J3 : ecrans Nutrition — kcal-card (pbar aria + macros), builder de repas
   (foodId + qty, totaux TOUJOURS recalcules, jamais stockes), aliments
   per-100 g (favoris / recents / Atwater qui AVERTIT sans bloquer),
   semaine 7 jours (stats + tendance poids). */
const { test, expect } = require('@playwright/test');
const { seed, today, daysAgo } = require('./helpers');

const GOAL = { kcal: 2500, p: 180, c: 250, f: 70 };
const OATS = { id: 'oats', name: 'Oats', kcal: 380, protein: 13, carbs: 66, fat: 7 };

const openNutri = async (page, tab = 'nutri-today') => {
  await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
  if (tab !== 'nutri-today') await page.locator('#rootSubnav [data-tab="' + tab + '"]').click();
};

test.describe('J3 : ecrans Nutrition', () => {

  test('Today : kcal-card, pbar aria, macros, repas en lecture seule', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [OATS], meals: [
      { id: 'm1', date: today(), type: 'lunch', name: 'Lunch',
        items: [{ foodId: 'oats', qty: 500, unit: 'g', name: 'Oats' }] }   /* 5x100g = 1900 kcal */
    ] } }, 'Mouataz');
    await openNutri(page);

    await expect(page.locator('.kcal-card')).toBeVisible();
    await expect(page.locator('.kcal-eaten')).toContainText('1900/ 2500 kcal');
    const bar = page.locator('.kcal-card > .pbar');
    await expect(bar).toHaveAttribute('role', 'progressbar');
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuemax', '2500');
    await expect(bar).toHaveAttribute('aria-valuenow', '1900');
    await expect(bar.locator('.sr-only')).toHaveText('1900 of 2500 kcal');

    await expect(page.locator('.macro.p .macro-name')).toContainText('Protein');
    await expect(page.locator('.macro.p .macro-val')).toContainText('65 / 180 g');   /* 13 g x 5 */

    /* lecture seule : pas de boutons d'edition dans Today */
    const card = page.locator('#nutriToday .meal-card');
    await expect(card).toContainText('Lunch');
    await expect(card).toContainText('Oats');
    await expect(card).toContainText('1900 kcal');
    expect(await page.locator('#nutriToday .ing-actions').count()).toBe(0);

    /* + Add meal ouvre le builder sur Meals */
    await page.locator('#nutriToday .nutri-add-bar button').click();
    await expect(page.locator('#tab-nutri-meals')).toBeVisible();
    expect(await page.evaluate(() => currentTab)).toBe('nutri-meals');
  });

  test('au-dela de 105 % : pbar.over + « over » au lieu de « left »', async ({ page }) => {
    await seed(page, { nutri: { goal: { kcal: 1500, p: 150, c: 150, f: 50 }, foods: [OATS], meals: [
      { id: 'm1', date: today(), type: 'lunch', name: 'Big lunch',
        items: [{ foodId: 'oats', qty: 500, unit: 'g', name: 'Oats' }] }   /* 1900 vs 1500 */
    ] } }, 'Mouataz');
    await openNutri(page);

    await expect(page.locator('.kcal-card > .pbar')).toHaveClass(/over/);
    await expect(page.locator('.kcal-left')).toContainText('400');
    await expect(page.locator('.kcal-left')).toContainText('over');
    await expect(page.locator('.kcal-left')).not.toContainText('left');
  });

  test('repas legacy (sans foodId) : totaux stockes conserves a l\'affichage', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [
      { id: 'lg', date: today(), name: 'Legacy pie',
        items: [{ name: 'Legacy pie', kcal: 400, p: 10, c: 50, f: 15 }] }
    ] } }, 'Mouataz');
    await openNutri(page);

    await expect(page.locator('.kcal-eaten')).toContainText('400/ 2500 kcal');
    await expect(page.locator('#nutriToday .meal-card')).toContainText('Legacy pie');
  });

  test('builder : foodId + qty, totaux live, edition / suppression de ligne', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [OATS] } }, 'Mouataz');
    await openNutri(page, 'nutri-meals');
    await page.locator('#tab-nutri-meals button:has-text("+ Meal")').click();

    await page.fill('#mealName', 'Breakfast');
    await page.selectOption('#mealType', 'breakfast');
    await page.fill('#mealFoodSearch', 'Oats');
    await page.locator('#nutriMeals .food-pick').first().click();

    /* editeur : defaut 100 g, preview recalculé en direct */
    await expect(page.locator('#itemQty')).toHaveValue('100');
    await expect(page.locator('#itemUnit')).toHaveValue('g');
    await expect(page.locator('#itemPreview')).toContainText('380 kcal');
    await page.fill('#itemQty', '250');
    await expect(page.locator('#itemPreview')).toContainText('950 kcal');
    await page.locator('#nutriMeals .item-editor button').click();
    await expect(page.locator('#mealDraftTotals')).toContainText('Totals: 950 kcal');

    /* edition de la ligne : 250 -> 300 g */
    await page.locator('#nutriMeals [aria-label="Edit ingredient"]').click();
    await expect(page.locator('#itemQty')).toHaveValue('250');
    await page.fill('#itemQty', '300');
    await page.locator('#nutriMeals .item-editor button').click();
    await expect(page.locator('#mealDraftTotals')).toContainText('Totals: 1140 kcal');

    /* suppression : plus de lignes -> hint */
    await page.locator('#nutriMeals [aria-label="Remove ingredient"]').click();
    await expect(page.locator('#mealDraftTotals')).toContainText('Search a food');

    /* re-ajout puis sauvegarde : seul foodId/qty/unit est stocke */
    await page.fill('#mealFoodSearch', 'Oats');
    await page.locator('#nutriMeals .food-pick').first().click();
    await page.fill('#itemQty', '500');
    await page.locator('#nutriMeals .item-editor button').click();
    await page.locator('#nutriMeals button:has-text("Save meal")').click();
    await expect(page.locator('#toast')).toContainText('Meal saved');

    const st = await page.evaluate(() => {
      const m = DB.nutri.meals.find(x => x.name === 'Breakfast');
      return { type: m.type, items: m.items };
    });
    expect(st.type).toBe('breakfast');
    expect(st.items).toHaveLength(1);
    expect(st.items[0].foodId).toBe('oats');
    expect(st.items[0].qty).toBe(500);
    expect(st.items[0].unit).toBe('g');
    expect(st.items[0].kcal, 'aucun total stocke').toBeUndefined();
    expect(st.items[0].p, 'aucun macro stocke').toBeUndefined();
  });

  test('repas : edition du nom sans doublon, puis suppression', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [OATS], meals: [
      { id: 'm1', date: today(), type: 'lunch', name: 'Lunch',
        items: [{ foodId: 'oats', qty: 100, unit: 'g', name: 'Oats' }] }
    ] } }, 'Mouataz');
    await openNutri(page, 'nutri-meals');

    await page.locator('#nutriMeals [aria-label="Edit meal"]').click();
    await expect(page.locator('#mealName')).toHaveValue('Lunch');
    await page.fill('#mealName', 'Lunch v2');
    await page.locator('#nutriMeals button:has-text("Save meal")').click();
    await expect(page.locator('#toast')).toContainText('Meal saved');
    const afterEdit = await page.evaluate(() => DB.nutri.meals.length);
    expect(afterEdit, 'pas de doublon').toBe(1);
    expect(await page.evaluate(() => DB.nutri.meals[0].name)).toBe('Lunch v2');

    await page.locator('#nutriMeals [aria-label="Delete meal"]').click();
    await expect(page.locator('#toast')).toContainText('Meal deleted');
    await expect(page.locator('#nutriMeals')).toContainText('Nothing logged yet');
    expect(await page.evaluate(() => DB.nutri.meals.length)).toBe(0);
  });

  test('copier de hier puis sauver le repas en recette', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [OATS], meals: [
      { id: 'ym', date: daysAgo(1), type: 'lunch', name: 'Yesterday lunch',
        items: [{ foodId: 'oats', qty: 100, unit: 'g', name: 'Oats' }] }
    ] } }, 'Mouataz');
    await openNutri(page, 'nutri-meals');
    await page.locator('#tab-nutri-meals button:has-text("+ Meal")').click();

    const chip = page.locator('.nutri-copy-row button:has-text("Yesterday lunch")');
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.locator('#mealDraftTotals')).toContainText('Totals: 380 kcal');
    await expect(page.locator('#mealName')).toHaveValue('Yesterday lunch');
    await page.locator('#nutriMeals button:has-text("Save meal")').click();
    await expect(page.locator('#toast')).toContainText('Meal saved');
    expect(await page.evaluate(() => DB.nutri.meals.length)).toBe(2);

    /* recette : l'etoile pousse le repas dans les aliments (per 100 g) */
    await page.locator('#nutriMeals [aria-label="Save as recipe"]').click();
    await expect(page.locator('#toast')).toContainText('saved to Foods');
    const rec = await page.evaluate(() =>
      DB.nutri.foods.find(f => f.name === 'Yesterday lunch'));
    expect(rec, 'recette creee').toBeTruthy();
    expect(Math.round(rec.kcal)).toBe(380);

    await page.locator('#rootSubnav [data-tab="nutri-foods"]').click();
    await expect(page.locator('#nutriFoods')).toContainText('Yesterday lunch');
  });

  test('Foods : recherche perso + base 690, favoris, recents, Atwater avertit sans bloquer', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [
      { id: 'sauce', name: 'Steakhouse sauce', kcal: 200, protein: 2, carbs: 10, fat: 18 }
    ] } }, 'Mouataz');
    await openNutri(page, 'nutri-foods');

    /* requete : aliments perso d'abord */
    await page.fill('#nutriFoodSearch', 'steak');
    await expect(page.locator('#nutriFoods .food-item:has-text("Steakhouse sauce")')).toBeVisible();

    /* base 690 en asynchrone (fetch data/foods.json) */
    await page.fill('#nutriFoodSearch', 'poulet');
    await expect(
      page.locator('#nutriFoods .food-item:has-text("Poulet")').first(),
      'resultats base apres fetch'
    ).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#nutriFoods')).toContainText('Your foods first');

    /* favori : etoile dans la section « Your foods » puis section « Favorites » */
    await page.fill('#nutriFoodSearch', '');
    await page.locator(
      '#nutriFoods .section-hint:has-text("Your foods") + .food-list ' +
      '.food-item:has-text("Steakhouse sauce") [aria-label="Favorite"]'
    ).click();
    await expect(page.locator('#nutriFoods .section-hint:has-text("Favorites")')).toBeVisible();
    await expect(page.locator(
      '#nutriFoods .section-hint:has-text("Favorites") + .food-list button:has-text("Log")'
    )).toBeVisible();

    /* log -> repas Snacks du jour */
    await page.locator(
      '#nutriFoods .section-hint:has-text("Favorites") + .food-list button:has-text("Log")'
    ).click();
    await expect(page.locator('#toast')).toContainText('Steakhouse sauce logged');

    /* un aliment de la base (pas un favori) -> section Recent apres vidage */
    await page.fill('#nutriFoodSearch', 'Nuggets de poulet');
    await page.locator(
      '#nutriFoods .food-item:has-text("Nuggets de poulet") button:has-text("Log")'
    ).click();
    await expect(page.locator('#toast')).toContainText('Nuggets de poulet logged');
    await page.fill('#nutriFoodSearch', '');
    await expect(page.locator('#nutriFoods .section-hint:has-text("Recent")')).toBeVisible();
    await expect(page.locator(
      '#nutriFoods .section-hint:has-text("Recent") + .food-list'
    )).toContainText('Nuggets de poulet');

    /* Atwater : on AVERTIT, on n'enregistre PAS moins (ici 0 vs 100 kcal) */
    await page.locator('#tab-nutri-foods button:has-text("+ Food")').click();
    await page.fill('#foodName', 'Soda');
    await page.fill('#foodKcal', '100');
    await page.locator('#nutriFoods button:has-text("Add")').click();
    await expect(page.locator('#toast')).toContainText('Food added');
    await expect(page.locator('#toast')).toContainText('check Atwater: 0 vs 100 kcal');

    const st = await page.evaluate(() => ({
      foods: DB.nutri.foods.length,
      favs: DB.nutri.favs,
      snack: (DB.nutri.meals.find(m => m.type === 'snack') || {}).items
    }));
    expect(st.foods, 'sauce + Soda enregistres malgre l\'avertissement').toBe(2);
    expect(st.favs).toContain('sauce');
    expect(st.snack[0], 'log sans totaux stockes')
      .toEqual({ foodId: 'sauce', qty: 100, unit: 'g', name: 'Steakhouse sauce' });
    expect(st.snack[1].foodId).toBe('nuggets-de-poulet--cuit');
    expect(st.snack[1].qty).toBe(100);
    expect(st.snack[1].unit).toBe('g');
  });

  test('Week : 7 jours, stats, aria de la barre, tendance poids', async ({ page }) => {
    await seed(page, {
      nutri: { goal: GOAL, foods: [OATS], meals: [
        { id: 'm1', date: today(), type: 'lunch', name: 'Lunch',
          items: [{ foodId: 'oats', qty: 500, unit: 'g', name: 'Oats' }] },      /* 1900 */
        { id: 'm2', date: daysAgo(3), type: 'dinner', name: 'Dinner',
          items: [{ foodId: 'oats', qty: 100, unit: 'g', name: 'Oats' }] }       /* 380 */
      ] },
      weightLog: [{ date: daysAgo(6), kg: 82 }, { date: today(), kg: 81.2 }]
    }, 'Mouataz');
    await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
    await page.locator('#rootSubnav [data-tab="nutri-week"]').click();
    await expect(page.locator('#tab-nutri-week')).toBeVisible();

    await expect(page.locator('#nutriWeek .week-row')).toHaveCount(7);
    const todayRow = page.locator('#nutriWeek .week-row').last();
    await expect(todayRow.locator('.pbar')).toHaveAttribute('role', 'progressbar');
    await expect(todayRow.locator('.pbar')).toHaveAttribute('aria-valuemax', '2500');
    await expect(todayRow.locator('.pbar')).toHaveAttribute('aria-valuenow', '1900');
    await expect(todayRow.locator('.week-kcal')).toContainText('1900 kcal');

    await expect(page.locator('#nutriWeek .week-stat')).toHaveCount(3);
    await expect(page.locator('#nutriWeek')).toContainText('days logged');
    await expect(page.locator('#nutriWeek')).toContainText('avg kcal');
    await expect(page.locator('#nutriWeek')).toContainText('days on target');

    /* tendance poids sur la fenêtre affichee */
    await expect(page.locator('#nutriWeek')).toContainText('82.0 → 81.2 kg');
    await expect(page.locator('#nutriWeek')).toContainText('-0.8 kg');

    /* vers Progression */
    await page.locator('#nutriWeek .nutri-add-bar button').click();
    expect(await page.evaluate(() => currentTab)).toBe('stats');
  });

  test('Week sans rien de loggé : état vide explicite', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [] } }, 'Mouataz');
    await openNutri(page, 'nutri-week');
    await expect(page.locator('#nutriWeek')).toContainText('Nothing logged this week');
    await expect(page.locator('#nutriWeek .week-row')).toHaveCount(0);
  });
});
