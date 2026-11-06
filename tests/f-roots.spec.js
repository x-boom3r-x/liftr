/* Chantier F — 4 onglets racine : Accueil | Muscu | Nutrition | Profil,
   plus un bouton + central (Publier).
   Règles : premier lancement connecté+online → Feed ; hors-ligne/déconnecté
   → Gym (bouton Feed toujours visible, racine bascule) ; sous-nav déplacée ;
   mémoire du dernier sous-onglet manuel ; module Nutrition local. */
const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { withSocial, signedIn, ME, consoleWatch, mockApi } = require('./social-mock');

test.describe('Chantier F : 4 onglets racine', () => {

  test('la tabbar a exactement 4 boutons racine (Feed, Gym, Nutrition, Profil) + le +', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('.tabbar .tab')].map(b => b.dataset.tab));
    expect(tabs).toEqual(['feed', 'gym', 'nutrition', 'profil']);
    /* pas de 5e bouton caché : les anciens onglets ne sont plus dans la barre */
    expect(await page.evaluate(() =>
      document.querySelectorAll('.tabbar .tab[data-tab="seance"], .tabbar .tab[data-tab="stats"], .tabbar .tab[data-tab="calendrier"], .tabbar .tab[data-tab="programme"], .tabbar .tab[data-tab="library"]').length)).toBe(0);
    /* le bouton + est bien présent, centré, et n'est PAS un .tab (pas de data-tab) */
    const plus = await page.evaluate(() => {
      const el = document.querySelector('.tabbar .plus');
      return el ? { label: el.getAttribute('aria-label'), tab: el.dataset.tab, mid: innerWidth / 2 } : null;
    });
    expect(plus, 'le bouton + existe dans la tabbar').toBeTruthy();
    expect(plus.label).toBe('Publier');
    expect(plus.tab, 'le + ne porte aucun data-tab (jamais actif)').toBeUndefined();
  });

  test('bouton Profil : ouvre la racine Profil sans toucher aux données', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.locator('.tabbar .tab[data-tab="profil"]').click();
    await expect(page.locator('#tab-profil')).toBeVisible();
    await expect(page.locator('.tabbar .tab[data-tab="profil"]')).toHaveClass(/active/);
    expect(await page.evaluate(() => currentTab)).toBe('profil');
    expect(await page.evaluate(() => currentRoot)).toBe('profil');
    /* pas de sous-nav sur Profil */
    await expect(page.locator('#rootSubnav')).toBeHidden();
  });

  test('bouton + : ramène au Feed et ouvre la feuille de création', async ({ page }) => {
    await withSocial(page);
    await seed(page, {}, 'Mouataz');
    mockApi(page, {});
    await signedIn(page);
    await page.evaluate(() => showTab('programme'));
    await page.locator('.tabbar .plus').click();
    await expect(page.locator('#tab-feed')).toBeVisible();
    await expect(page.locator('#actionSheet')).toBeVisible();
  });

  test('bouton + déconnecté : toast d\'aide, pas de feuille', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.locator('.tabbar .plus').click();
    await expect(page.locator('#toast')).toContainText('Sign in and go online');
    await expect(page.locator('#actionSheet')).toBeHidden();
  });

  test('déconnecté : atterrissage Gym, bouton Feed visible, clic → toast + Gym', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    expect(await page.evaluate(() => currentTab)).toBe('programme');
    await expect(page.locator('.tabbar .tab[data-tab="gym"]')).toHaveClass(/active/);
    await expect(page.locator('#tabFeedBtn')).toBeVisible();

    await page.locator('#tabFeedBtn').click();
    await expect(page.locator('#toast')).toContainText('Sign in and go online');
    expect(await page.evaluate(() => currentTab)).toBe('programme');
  });

  test('connecté+online : premier lancement atterrit sur Feed', async ({ page }) => {
    await withSocial(page);
    await seed(page, {}, 'Mouataz');
    mockApi(page, {});
    await signedIn(page);
    /* simule un premier lancement de session : la mémoire est vidée */
    await page.evaluate(() => { localStorage.removeItem('at_tab'); setUser('Mouataz'); });
    expect(await page.evaluate(() => currentTab)).toBe('feed');
    await expect(page.locator('#tab-feed')).toBeVisible();
    await expect(page.locator('.tabbar .tab[data-tab="feed"]')).toHaveClass(/active/);
  });

  test('hors-ligne : Feed bascule sur Gym avec toast, bouton toujours visible', async ({ page, context }) => {
    await withSocial(page);
    await seed(page, {}, 'Mouataz');
    mockApi(page, {});
    await signedIn(page);
    await page.locator('#tabFeedBtn').click();
    await expect(page.locator('#tab-feed')).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); updateSocialGate(); });
    await expect(page.locator('#tab-feed')).toBeHidden();
    expect(await page.evaluate(() => currentTab)).toBe('programme');
    await expect(page.locator('#tabFeedBtn')).toBeVisible();

    await context.setOffline(false);
  });

  test('Gym : sous-nav déplacée (Plan, Session, Library, Calendar, Progression)', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    const nav = page.locator('#rootSubnav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('.subnav-item')).toHaveCount(5);
    await expect(nav).toContainText('Plan');
    await expect(nav).toContainText('Session');
    await expect(nav).toContainText('Library');
    await expect(nav).toContainText('Calendar');
    await expect(nav).toContainText('Progression');

    await nav.locator('[data-tab="seance"]').click();
    await expect(page.locator('#tab-seance')).toBeVisible();
    await expect(nav.locator('[data-tab="seance"]')).toHaveClass(/active/);
    expect(await page.evaluate(() => currentTab)).toBe('seance');

    /* écran Library (nouveau, build 84) */
    await nav.locator('[data-tab="library"]').click();
    await expect(page.locator('#tab-library')).toBeVisible();
    await expect(page.locator('#libScreenGrid .lib-item').first()).toBeVisible();
    expect(await page.evaluate(() => currentRoot)).toBe('gym');

    await nav.locator('[data-tab="stats"]').click();
    await expect(page.locator('#tab-stats')).toBeVisible();
    await expect(page.locator('#tab-stats .section-title')).toHaveText('Progression');
    /* Export CSV en bas de Progression (F) */
    await expect(page.locator('#tab-stats button:has-text("Export CSV")')).toBeVisible();
  });

  test('mémoire : Gym renvoie au dernier sous-onglet visité', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.locator('#rootSubnav [data-tab="calendrier"]').click();
    await expect(page.locator('#tab-calendrier')).toBeVisible();

    await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
    await expect(page.locator('#tab-nutri-today')).toBeVisible();

    await page.locator('.tabbar .tab[data-tab="gym"]').click();
    await expect(page.locator('#tab-calendrier')).toBeVisible();
  });

  test('Nutrition : sous-nav Today/Meals/Foods/Goal/Week + flux complet', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.locator('.tabbar .tab[data-tab="nutrition"]').click();
    const nav = page.locator('#rootSubnav');
    await expect(nav).toContainText('Today');
    await expect(nav).toContainText('Meals');
    await expect(nav).toContainText('Foods');
    await expect(nav).toContainText('Goal');
    await expect(nav).toContainText('Week');
    await expect(page.locator('#tab-nutri-today')).toBeVisible();
    await expect(page.locator('#nutriToday')).toContainText('No goal set yet');

    /* objectif */
    await nav.locator('[data-tab="nutri-goal"]').click();
    await page.fill('#goalKcal', '2500');
    await page.fill('#goalP', '180');
    await page.fill('#goalC', '250');
    await page.fill('#goalF', '70');
    await page.locator('#tab-nutri-goal button:has-text("Save goal")').click();
    await expect(page.locator('#toast')).toContainText('Goal saved');

    /* aliments perso per 100 g */
    await nav.locator('[data-tab="nutri-foods"]').click();
    await page.locator('#tab-nutri-foods button:has-text("+ Food")').click();
    await page.fill('#foodName', 'Meal base');
    await page.fill('#foodKcal', '70');
    await page.fill('#foodP', '4');
    await page.fill('#foodC', '8');
    await page.fill('#foodF', '2');
    await page.locator('#nutriFoods button:has-text("Add")').click();
    await expect(page.locator('#toast')).toContainText('Food added');
    await expect(page.locator('#nutriFoods')).toContainText('Meal base');

    /* repas via le builder : recherche -> foodId -> qty 1000 g (aucun total stocké) */
    await nav.locator('[data-tab="nutri-meals"]').click();
    await page.locator('#tab-nutri-meals button:has-text("+ Meal")').click();
    await page.fill('#mealName', 'Lunch');
    await page.fill('#mealFoodSearch', 'Meal base');
    await page.locator('#nutriMeals .food-pick').first().click();
    await expect(page.locator('#itemQty')).toBeVisible();
    await page.fill('#itemQty', '1000');
    await page.locator('#nutriMeals button:has-text("Add to meal")').click();
    await expect(page.locator('#mealDraftTotals')).toContainText('Totals: 700 kcal');
    await page.locator('#nutriMeals button:has-text("Save meal")').click();
    await expect(page.locator('#toast')).toContainText('Meal saved');
    await expect(page.locator('#nutriMeals .meal-card')).toContainText('Lunch');
    await expect(page.locator('#nutriMeals .meal-card')).toContainText('700 kcal');

    /* today : totaux recalculés + macros */
    await nav.locator('[data-tab="nutri-today"]').click();
    await expect(page.locator('.ring-stats .ring-stat .rs-n').first()).toHaveText('700');
    await expect(page.locator('#nutriToday')).toContainText('Protein');

    /* aliments : ajout + log vers Snacks (100 g) */
    await nav.locator('[data-tab="nutri-foods"]').click();
    await page.locator('#tab-nutri-foods button:has-text("+ Food")').click();
    await page.fill('#foodName', 'Rice 100g');
    await page.fill('#foodKcal', '130');
    await page.fill('#foodP', '3');
    await page.fill('#foodC', '28');
    await page.locator('#nutriFoods button:has-text("Add")').click();
    await expect(page.locator('#toast')).toContainText('Food added');
    await expect(page.locator('#toast')).not.toContainText('check Atwater');
    await page.locator('#nutriFoods .food-item:has-text("Rice 100g") .fadd').click();
    await expect(page.locator('#toast')).toContainText('Rice 100g logged');

    await nav.locator('[data-tab="nutri-today"]').click();
    await expect(page.locator('.ring-stats .ring-stat .rs-n').first()).toHaveText('830');

    /* les données nutrition sont persistées dans DB.nutri */
    const n = await page.evaluate(() => DB.nutri);
    expect(n.goal.kcal).toBe(2500);
    expect(n.foods.length).toBe(2);
    expect(n.meals.length).toBe(2);          /* Lunch + Snacks */
    /* J3 : le repas ne stocke que foodId + qty + unit, jamais les totaux */
    const lunch = n.meals.find(m => m.name === 'Lunch');
    expect(lunch.items[0].foodId).toBeTruthy();
    expect(lunch.items[0].qty).toBe(1000);
    expect(lunch.items[0].kcal).toBeUndefined();
  });

  test('sous-vues Feed : bouton ‹ visible, retour contextuel', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {}, 'Mouataz');
    mockApi(page, {});   /* feed chargé : le backend est simulé, pas de fetch réel */
    await signedIn(page);
    await page.evaluate(() => { localStorage.setItem('at_tab', 'feed'); setUser('Mouataz'); });
    await expect(page.locator('#tab-feed')).toBeVisible();
    await expect(page.locator('#feedBackBtn')).toBeHidden();   /* Home : pas de retour */

    await page.locator('#socialNav [data-view="search"]').click();
    await expect(page.locator('#view-search')).toBeVisible();
    await expect(page.locator('#feedBackBtn')).toBeVisible();
    await page.locator('#feedBackBtn').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#feedBackBtn')).toBeHidden();
    expect(errs).toEqual([]);
  });
});
