/* J3 : ecrans Nutrition — anneau ONT (ring-card + macros), builder de repas
   (foodId + qty, totaux TOUJOURS recalcules, jamais stockes), aliments
   per-100 g (fiche detail + favoris / recents / Atwater qui AVERTIT sans
   bloquer), semaine (streak + graphe calories + moyennes). */
const { test, expect } = require('@playwright/test');
const { seed, today, daysAgo } = require('./helpers');

const GOAL = { kcal: 2500, p: 180, c: 250, f: 70 };
const OATS = { id: 'oats', name: 'Oats', kcal: 380, protein: 13, carbs: 66, fat: 7 };

const openNutri = async (page, tab = 'nutri-today') => {
  await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
  if (tab !== 'nutri-today') await page.locator('#rootSubnav [data-tab="' + tab + '"]').click();
};

test.describe('J3 : ecrans Nutrition', () => {

  test('Today : anneau kcal, eaten/target, macros, repas en lecture seule', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [OATS], meals: [
      { id: 'm1', date: today(), type: 'lunch', name: 'Lunch',
        items: [{ foodId: 'oats', qty: 500, unit: 'g', name: 'Oats' }] }   /* 5x100g = 1900 kcal */
    ] } }, 'Mouataz');
    await openNutri(page);

    await expect(page.locator('.ring-card')).toBeVisible();
    await expect(page.locator('.ring-stats .ring-stat .rs-n').first()).toHaveText('1900');   /* eaten */
    await expect(page.locator('.ring-stats .ring-stat.right .rs-n')).toHaveText('2500');      /* target */
    await expect(page.locator('.ring-center')).toContainText('600');                          /* 2500-1900 */
    await expect(page.locator('.ring-center')).toContainText('kcal left');

    /* macros : 3 cartes Carbs / Fat / Protein */
    await expect(page.locator('.mcard.p .mcard-top')).toContainText('Protein');
    await expect(page.locator('.mcard.p .mcard-val')).toContainText('65 / 180 g');   /* 13 g x 5 */

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

  test('au-dela de 105 % : ring-center.over + « over » au lieu de « left »', async ({ page }) => {
    await seed(page, { nutri: { goal: { kcal: 1500, p: 150, c: 150, f: 50 }, foods: [OATS], meals: [
      { id: 'm1', date: today(), type: 'lunch', name: 'Big lunch',
        items: [{ foodId: 'oats', qty: 500, unit: 'g', name: 'Oats' }] }   /* 1900 vs 1500 */
    ] } }, 'Mouataz');
    await openNutri(page);

    await expect(page.locator('.ring-center')).toHaveClass(/over/);
    await expect(page.locator('.ring-center')).toContainText('400');
    await expect(page.locator('.ring-center')).toContainText('over');
    await expect(page.locator('.ring-center')).not.toContainText('kcal left');
    await expect(page.locator('.ring-fg')).toHaveClass(/over/);
  });

  test('repas legacy (sans foodId) : totaux stockes conserves a l\'affichage', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [
      { id: 'lg', date: today(), name: 'Legacy pie',
        items: [{ name: 'Legacy pie', kcal: 400, p: 10, c: 50, f: 15 }] }
    ] } }, 'Mouataz');
    await openNutri(page);

    await expect(page.locator('.ring-stats .ring-stat .rs-n').first()).toHaveText('400');
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

  test('Foods : recherche perso + base 690, fiche detail, favoris, recents, Atwater', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [
      { id: 'sauce', name: 'Steakhouse sauce', kcal: 200, protein: 2, carbs: 10, fat: 18 }
    ] } }, 'Mouataz');
    await openNutri(page, 'nutri-foods');

    /* requete : aliments perso d'abord */
    await page.fill('#nutriFoodSearch', 'steak');
    await expect(page.locator('#nutriFoods .food-item:has-text("Steakhouse sauce")')).toBeVisible();

    /* fiche detail : clic sur la carte ouvre la modale */
    await page.locator('#nutriFoods .food-item:has-text("Steakhouse sauce") .fn').click();
    await expect(page.locator('#foodDetailModal')).toHaveClass(/show/);
    await expect(page.locator('#foodDetailBody .fd-name')).toHaveText('Steakhouse sauce');
    await expect(page.locator('#foodDetailBody')).toContainText('Per 100 g');
    await expect(page.locator('#foodDetailBody .fd-row.big')).toContainText('Calories');

    /* favori depuis la fiche */
    await page.locator('#foodDetailBody [aria-label="Favorite"]').click();
    expect(await page.evaluate(() => DB.nutri.favs), 'favori enregistre').toContain('sauce');

    /* log depuis la fiche -> repas Snacks du jour */
    await page.locator('#foodDetailBody button:has-text("Log food")').click();
    await expect(page.locator('#toast')).toContainText('Steakhouse sauce logged');
    await expect(page.locator('#foodDetailModal')).not.toHaveClass(/show/);

    /* base 690 en asynchrone + log d'un aliment NON favori -> alimente la section Recent */
    await page.fill('#nutriFoodSearch', 'poulet');
    await expect(
      page.locator('#nutriFoods .food-item:has-text("Poulet")').first(),
      'resultats base apres fetch'
    ).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#nutriFoods')).toContainText('Your foods first');
    await page.locator('#nutriFoods .food-item:has-text("Poulet") .fadd').first().click();
    await expect(page.locator('#toast')).toContainText('logged');

    /* sections Favorites / Recent visibles apres vidage de la recherche */
    await page.fill('#nutriFoodSearch', '');
    await expect(page.locator('#nutriFoods .section-hint:has-text("Favorites")')).toBeVisible();
    await expect(page.locator('#nutriFoods .section-hint:has-text("Recent")')).toBeVisible();

    /* chips de filtre : Favorites n'affiche que les favoris */
    await page.locator('.fchip:has-text("Favorites")').click();
    await expect(page.locator('.fchip:has-text("Favorites")')).toHaveClass(/active/);
    await expect(page.locator('#nutriFoods .food-item:has-text("Steakhouse sauce")')).toBeVisible();
    await page.locator('.fchip:has-text("All")').click();

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
    expect(st.foods, 'sauce (perso) + Soda enregistres ; Poulet (base) logge sans etre importe')
      .toBe(2);
    expect(st.favs).toContain('sauce');
    expect(st.snack[0], 'log sans totaux stockes')
      .toEqual({ foodId: 'sauce', qty: 100, unit: 'g', name: 'Steakhouse sauce' });
  });

  test('Week : streak, graphe calories, moyennes, tendance poids', async ({ page }) => {
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

    /* streak : aujourd'hui loggue mais hier non -> 1 jour */
    await expect(page.locator('#nutriWeek .streak-card')).toBeVisible();
    await expect(page.locator('#nutriWeek .streak-n')).toContainText('1');
    await expect(page.locator('#nutriWeek .streak-n')).toContainText('day');

    /* plage 7j active + graphe (aire + ligne + points) */
    await expect(page.locator('#nutriWeek .seg.active')).toHaveText('7d');
    await expect(page.locator('#nutriWeek .chart-line')).toBeVisible();
    await expect(page.locator('#nutriWeek .chart-area')).toBeVisible();
    expect(await page.locator('#nutriWeek .chart-goal').count(), 'ligne objectif pointillee').toBe(1);
    await expect(page.locator('#nutriWeek')).toContainText('Dashed line = goal');
    expect(await page.locator('#nutriWeek .chart-dot').count()).toBe(7);

    /* moyennes journalieres : 2 jours loggues (1900 + 380) / 2 = 1140 */
    await expect(page.locator('#nutriWeek .daysum-kcal')).toContainText('1140');
    await expect(page.locator('#nutriWeek .daysum-kcal')).toContainText('/ 2500 kcal');
    await expect(page.locator('#nutriWeek .avg-row:has-text("Carbs")')).toBeVisible();
    await expect(page.locator('#nutriWeek .avg-row:has-text("Fat")')).toBeVisible();
    await expect(page.locator('#nutriWeek .avg-row:has-text("Protein")')).toBeVisible();

    /* tendance poids sur la fenetre affichee */
    await expect(page.locator('#nutriWeek')).toContainText('82.0 kg');
    await expect(page.locator('#nutriWeek')).toContainText('-0.8 kg');
    await expect(page.locator('#nutriWeek')).toContainText('81.2');

    /* vers Progression */
    await page.locator('#nutriWeek .nutri-add-bar button').click();
    expect(await page.evaluate(() => currentTab)).toBe('stats');
  });

  test('Week sans rien de loggé : état vide explicite', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [] } }, 'Mouataz');
    await openNutri(page, 'nutri-week');
    await expect(page.locator('#nutriWeek')).toContainText('Nothing logged this week');
    await expect(page.locator('#nutriWeek .chart-line')).toHaveCount(0);
    await expect(page.locator('#nutriWeek .week-row')).toHaveCount(0);
  });
});
