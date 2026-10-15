/* Chantier Nutrition (build 74) : multi-jour, eau, fibres, recettes,
   recherche web (Open Food Facts + USDA), codes-barres / scanner.
   Aucune regression des 5 sous-onglets Today/Meals/Foods/Goal/Week :
   les screens existants (j1/j2/j3/m2/f-roots) restent la reference. */
const { test, expect } = require('@playwright/test');
const { seed, today, daysAgo } = require('./helpers');

const GOAL = { kcal: 2500, p: 180, c: 250, f: 70 };
const OATS = { id: 'oats', name: 'Oats', kcal: 380, protein: 13, carbs: 66, fat: 7 };

const openNutri = async (page, tab = 'nutri-today') => {
  await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
  if (tab !== 'nutri-today') await page.locator('#rootSubnav [data-tab="' + tab + '"]').click();
};

/* produits simules pour les mocks (jamais d'appel reseau dans les tests) */
const OFF_NUTELLA = {
  code: '3017620422003', product_name: 'Nutella', brands: 'Ferrero',
  categories: 'Spreads', serving_quantity: 15, serving_size: '15 g',
  nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 56.3,
    fat_100g: 30.9, fiber_100g: 0, sugars_100g: 56.3, sodium_100g: 0.107 }
};
const USDA_WHEAT = {
  fdcId: 173944, description: 'Wheat, bread', dataType: 'SR Legacy',
  foodNutrients: [
    { nutrientName: 'Energy', value: 247, unitName: 'kcal' },
    { nutrientName: 'Protein', value: 8.9 },
    { nutrientName: 'Carbohydrate, by difference', value: 41.3 },
    { nutrientName: 'Total lipid (fat)', value: 3.2 },
    { nutrientName: 'Fiber, total dietary', value: 2.7 },
    { nutrientName: 'Sodium, Na', value: 434 }
  ]
};

test.describe('Chantier Nutrition (build 74)', () => {

  test('helpers purs : codes-barres (format + modulo-10) via LiftrRemote', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const r = await page.evaluate(() => {
      const R = window.LiftrRemote;
      return {
        fmt8: R.isBarcodeFormat('96385074'),
        fmt13: R.isBarcodeFormat('4006381333931'),
        fmt14: R.isBarcodeFormat('12345678901234'),
        fmtLetters: R.isBarcodeFormat('abc123'),
        fmtShort: R.isBarcodeFormat('12345'),
        v8: R.isValidBarcodeCheckDigit('96385074'),
        v8bad: R.isValidBarcodeCheckDigit('96385075'),
        v13: R.isValidBarcodeCheckDigit('4006381333931'),
        v13bad: R.isValidBarcodeCheckDigit('4006381333932'),
        vUpc: R.isValidBarcodeCheckDigit('036000291452'),
        vLen: R.isValidBarcodeCheckDigit('12345')
      };
    });
    expect(r.fmt8).toBe(true);
    expect(r.fmt13).toBe(true);
    expect(r.fmt14).toBe(true);
    expect(r.fmtLetters, 'lettres rejetees').toBe(false);
    expect(r.fmtShort, '5 chiffres trop court').toBe(false);
    expect(r.v8, 'EAN-8 valide').toBe(true);
    expect(r.v8bad, 'EAN-8 mauvais chiffre de controle').toBe(false);
    expect(r.v13, 'EAN-13 valide').toBe(true);
    expect(r.v13bad).toBe(false);
    expect(r.vUpc, 'UPC-A 12 chiffres').toBe(true);
    expect(r.vLen, 'longueur non supportee').toBe(false);
  });

  test('normalisation OFF / USDA -> modele per-100 g (sodium mg, kJ, kcal null)', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const r = await page.evaluate(({ offN, usdaW }) => {
      const R = window.LiftrRemote;
      return {
        off: R.offToFood(offN),
        offNoKcal: R.offToFood({ code: 'x1', product_name: 'NoKcal', nutriments: {} }),
        usda: R.usdaToFood(usdaW),
        usdaKj: R.usdaToFood({ fdcId: 2, description: 'Energy kJ', dataType: 'Foundation',
          foodNutrients: [{ nutrientName: 'Energy', value: 1000, unitName: 'kJ' }] })
      };
    }, { offN: OFF_NUTELLA, usdaW: USDA_WHEAT });

    expect(r.off.id).toBe('off:3017620422003');
    expect(r.off.source).toBe('off');
    expect(r.off.kcal).toBe(539);
    expect(r.off.sodium_mg, '0.107 g -> 107 mg').toBe(107);
    expect(r.off.brands).toBe('Ferrero');
    expect(r.off.portions[0].grams, 'serving_quantity 15 g').toBe(15);
    expect(r.offNoKcal, 'sans kcal -> null (jamais 0 trompeur)').toBeNull();

    expect(r.usda.id).toBe('usda:173944');
    expect(r.usda.source).toBe('usda');
    expect(r.usda.kcal).toBe(247);
    expect(r.usda.sodium_mg).toBe(434);
    expect(r.usdaKj.kcal, '1000 kJ / 4.184 = 239').toBe(239);
  });

  test('hydratation : objectif auto 35 ml/kg, verres, override persistant', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [] },
      weightLog: [{ date: today(), kg: 82 }] }, 'Mouataz');
    await openNutri(page);

    const water = page.locator('#nutriToday .water-card');
    await expect(water).toBeVisible();
    /* auto : 82 kg * 35 ml = 2870 -> arrondi 2900 ml */
    await expect(water.locator('.water-val')).toContainText('/ 2900 ml');
    await expect(water.locator('.water-glasses')).toContainText('0 glasses');

    await water.locator('.water-add').click();            /* +250 */
    await water.locator('button:has-text("+ 500")').click(); /* +500 */
    await expect(water.locator('.water-val')).toContainText('750');
    await expect(water.locator('.water-glasses')).toContainText('3 glasses');

    await water.locator('[aria-label="Remove 250 ml"]').click(); /* -250 -> 500 */
    await expect(water.locator('.water-val')).toContainText('500');
    expect(await page.evaluate(() => DB.nutri.water[todayISO()]), 'eau memorisee').toBe(500);

    /* override de l'objectif dans Goal */
    await page.locator('#rootSubnav [data-tab="nutri-goal"]').click();
    const extra = page.locator('#nutriExtraGoals');
    await expect(extra).toBeVisible();
    await expect(extra).toContainText('2900 ml');
    await page.fill('#waterGoalInput', '3200');
    await extra.locator('button:has-text("Save water goal")').click();
    await expect(page.locator('#toast')).toContainText('Water goal saved');
    expect(await page.evaluate(() => DB.nutri.profile.waterGoalMl)).toBe(3200);
    /* Today suit le nouvel objectif */
    await page.locator('#rootSubnav [data-tab="nutri-today"]').click();
    await expect(page.locator('#nutriToday .water-card .water-val')).toContainText('/ 3200 ml');
  });

  test('fibres : objectif 14 g / 1000 kcal dans Goal', async ({ page }) => {
    /* goal manuel 2500 kcal (pas de plan) -> fiberTargetG(2500) = 35 g */
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [] } }, 'Mouataz');
    await openNutri(page, 'nutri-goal');
    const extra = page.locator('#nutriExtraGoals');
    await expect(extra).toBeVisible();
    await expect(extra).toContainText('Fiber');
    await expect(extra).toContainText('35 g');
  });

  test('multi-jour : calendrier, isolement des repas, retour Today', async ({ page }) => {
    const yd = daysAgo(1);
    await seed(page, { nutri: { goal: GOAL, foods: [OATS], meals: [
      { id: 'ym', date: yd, type: 'lunch', name: 'Yesterday lunch',
        items: [{ foodId: 'oats', qty: 100, unit: 'g', name: 'Oats' }] },
      { id: 'td', date: today(), type: 'dinner', name: 'Today dinner',
        items: [{ foodId: 'oats', qty: 100, unit: 'g', name: 'Oats' }] }
    ] } }, 'Mouataz');
    await openNutri(page, 'nutri-meals');

    /* aujourd'hui par defaut : jour .today + .sel, seul le repas du jour */
    await expect(page.locator('#nutriMeals .cal-day.today')).toBeVisible();
    await expect(page.locator('#nutriMeals .cal-day.sel')).toHaveClass(/today/);
    await expect(page.locator('#nutriMeals .daysum-date')).toHaveText('Today');
    await expect(page.locator('#nutriMeals')).toContainText('Today dinner');
    await expect(page.locator('#nutriMeals')).not.toContainText('Yesterday lunch');

    /* jour precedent via le calendrier */
    await page.locator('#nutriMeals .cal-day[aria-label^="' + yd + '"]').click();
    await expect(page.locator('#nutriMeals')).toContainText('Yesterday lunch');
    await expect(page.locator('#nutriMeals')).not.toContainText('Today dinner');
    await expect(page.locator('#nutriMeals .daysum-date')).not.toHaveText('Today');

    /* retour Today */
    await page.locator('#nutriMeals .calstrip-head .chip:has-text("Today")').click();
    await expect(page.locator('#nutriMeals')).toContainText('Today dinner');
    await expect(page.locator('#nutriMeals .cal-day.sel')).toHaveClass(/today/);
  });

  test('recettes : repas sauve en recette, liste dans Foods, reutilisable', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [OATS], meals: [] } }, 'Mouataz');
    await openNutri(page, 'nutri-meals');
    await page.locator('#tab-nutri-meals button:has-text("+ Meal")').click();
    await page.fill('#mealName', 'Bulk shake');
    await page.fill('#mealFoodSearch', 'Oats');
    await page.locator('#nutriMeals .food-pick').first().click();
    await page.fill('#itemQty', '150');
    await page.locator('#nutriMeals .item-editor button').click();
    await page.locator('#nutriMeals button:has-text("Save meal")').click();
    await expect(page.locator('#toast')).toContainText('Meal saved');

    /* sauver en recette : aliment per-100 g + template reutilisable */
    await page.locator('#nutriMeals [aria-label="Save as recipe"]').click();
    await expect(page.locator('#toast')).toContainText('saved to Foods');
    const st = await page.evaluate(() => ({
      food: !!DB.nutri.foods.find(f => f.name === 'Bulk shake'),
      recipe: (DB.nutri.recipes || []).find(r => r.name === 'Bulk shake')
    }));
    expect(st.food, 'aliment per-100 g cree').toBe(true);
    expect(st.recipe, 'template recette cree').toBeTruthy();
    expect(st.recipe.items[0].foodId).toBe('oats');
    expect(st.recipe.items[0].qty).toBe(150);

    /* la recette figure dans Foods */
    await page.locator('#rootSubnav [data-tab="nutri-foods"]').click();
    await expect(page.locator('#nutriFoods .section-hint:has-text("Recipes")')).toBeVisible();
    await expect(page.locator('#nutriFoods .recipe-row:has-text("Bulk shake")')).toBeVisible();

    /* reutiliser : charge un nouveau repas dans le builder */
    await page.locator('#nutriFoods .recipe-row button:has-text("Use")').click();
    expect(await page.evaluate(() => currentTab)).toBe('nutri-meals');
    await expect(page.locator('#mealName')).toHaveValue('Bulk shake');
    await expect(page.locator('#mealDraftTotals')).toContainText('Totals: 570 kcal'); /* 150 g * 380 */

    /* suppression de la recette */
    await page.locator('#rootSubnav [data-tab="nutri-foods"]').click();
    await page.locator('#nutriFoods .recipe-row [aria-label="Delete recipe"]').click();
    await expect(page.locator('#toast')).toContainText('Recipe deleted');
    expect(await page.evaluate(() => (DB.nutri.recipes || []).length)).toBe(0);
  });

  test('recherche web (OFF + USDA mock) : section "From the web" + Log persiste', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [] } }, 'Mouataz');
    await page.route('**/cgi/search.pl*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ products: [OFF_NUTELLA] })
    }));
    await page.route('**/fdc/v1/foods/search*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ foods: [USDA_WHEAT] })
    }));
    await openNutri(page, 'nutri-foods');

    await page.fill('#nutriFoodSearch', 'nutella');
    await expect(page.locator('#nutriFoods .section-hint:has-text("From the web")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#nutriFoods .food-item:has-text("Nutella")')).toBeVisible();
    await expect(page.locator('#nutriFoods .food-item:has-text("Wheat, bread")')).toBeVisible();
    await expect(page.locator('#nutriFoods .food-item:has-text("Nutella")'), 'badge source').toContainText('OFF');

    /* Log depuis le web : importe dans n.foods (source off) + toast */
    await page.locator(
      '#nutriFoods .section-hint:has-text("From the web") + .food-list ' +
      '.food-item:has-text("Nutella") .fadd'
    ).click();
    await expect(page.locator('#toast')).toContainText('Nutella logged');
    const persisted = await page.evaluate(() => DB.nutri.foods.find(f => f.id === 'off:3017620422003'));
    expect(persisted, 'aliment distant importe').toBeTruthy();
    expect(persisted.source).toBe('off');
    expect(persisted.kcal).toBe(539);
  });

  test('lookup code-barres (mock OFF) : trouve, import idempotent, format invalide, introuvable', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [] } }, 'Mouataz');
    await page.route('**/api/v2/product/**', route => {
      const url = route.request().url();
      if (url.includes('3017620422003')){
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 1, product: OFF_NUTELLA }) });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 0, product: null }) });
      }
    });

    /* produit valide : normalise */
    const found = await page.evaluate(() => window.LiftrRemote.lookupBarcode('3017620422003'));
    expect(found.food).toBeTruthy();
    expect(found.food.id).toBe('off:3017620422003');
    expect(found.food.kcal).toBe(539);
    expect(found.food.portions[0].grams).toBe(15);

    /* import idempotent dans n.foods (pas de doublon) */
    const count = await page.evaluate(() => {
      const food = { id: 'off:3017620422003', name: 'Nutella', kcal: 539, source: 'off' };
      window.LiftrRemote.importRemoteFood(food);
      window.LiftrRemote.importRemoteFood(food);
      return DB.nutri.foods.filter(f => f.id === 'off:3017620422003').length;
    });
    expect(count).toBe(1);

    /* format invalide (trop court) : refuse sans appeler l'API */
    const bad = await page.evaluate(() => window.LiftrRemote.lookupBarcode('1234'));
    expect(bad.invalid).toBe(true);
    expect(bad.food).toBeNull();

    /* format valide mais produit introuvable (mock status 0) */
    const nf = await page.evaluate(() => window.LiftrRemote.lookupBarcode('96385074'));
    expect(nf.invalid).toBe(false);
    expect(nf.food).toBeNull();
  });

  test('logRemoteFood : aliment importe ajoute au repas Snacks (chemin scanner)', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [] } }, 'Mouataz');
    await page.evaluate(() => {
      window.LiftrRemote.importRemoteFood(
        { id: 'off:bar1', name: 'Protein bar', kcal: 200, protein: 10, carbs: 20, fat: 8, source: 'off' });
      window.logRemoteFood('off:bar1', 60, 'g');
    });
    await expect(page.locator('#toast')).toContainText('Protein bar logged');
    const snack = await page.evaluate(() => {
      const m = DB.nutri.meals.find(x => x.type === 'snack');
      return m && m.items[0];
    });
    expect(snack.foodId).toBe('off:bar1');
    expect(snack.qty).toBe(60);
    expect(snack.unit).toBe('g');
    expect(snack.name).toBe('Protein bar');
  });

  test('scanner : modale .show (pas .open), fiche perso pre-remplie avec un code', async ({ page }) => {
    await seed(page, { nutri: { goal: GOAL, foods: [], meals: [] } }, 'Mouataz');
    await openNutri(page, 'nutri-foods');

    /* ouverture : la modale porte la classe .show */
    await page.evaluate(() => window.openScanner());
    await expect(page.locator('#scanModal')).toHaveClass(/show/);
    await expect(page.locator('#scanModal')).toHaveAttribute('aria-hidden', 'false');

    /* fermeture : .show retiree */
    await page.evaluate(() => window.closeScanner());
    await expect(page.locator('#scanModal')).not.toHaveClass(/show/);

    /* code-barres -> fiche perso pre-remplie (produit introuvable) */
    await page.evaluate(() => window.addFoodWithBarcode('3017620422003'));
    await expect(page.locator('#nutriFoods .food-form')).toBeVisible();
    await expect(page.locator('#foodBarcode')).toHaveValue('3017620422003');
  });
});
