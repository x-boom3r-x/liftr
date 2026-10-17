/* Chantier : layout du clone — barre sociale en bas avec les onglets
   Home · Search · Create(+) · Reels · Messages · Profile, au-dessus de
   la tabbar de l'app. Vérifie la structure, le positionnement et la
   navigation entre Home / Reels / Create. */
const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ME_P, withSocial, signedIn, openFeed, mockApi, post, consoleWatch } =
  require('./social-mock');

test.describe('Navigation basse (layout clone)', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
  });

  test('la barre sociale contient Home, Search, Create, Reels, Messages, Profile', async ({ page }) => {
    await mockApi(page, { posts: [], people: [ME_P] });
    await openFeed(page);

    const nav = page.locator('#socialNav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('[data-view="home"]')).toHaveCount(1);
    await expect(nav.locator('[data-view="search"]')).toHaveCount(1);
    await expect(nav.locator('#socialCreate')).toHaveCount(1);
    await expect(nav.locator('[data-view="reels"]')).toHaveCount(1);
    await expect(nav.locator('[data-view="inbox"]')).toHaveCount(1);
    await expect(nav.locator('[data-view="profile"]')).toHaveCount(1);
  });

  test('la barre sociale est fixée au-dessus de la tabbar de l’app', async ({ page }) => {
    await mockApi(page, { posts: [], people: [ME_P] });
    await openFeed(page);
    await page.waitForTimeout(150);

    const r = await page.evaluate(() => {
      const nav = document.getElementById('socialNav').getBoundingClientRect();
      const bar = document.querySelector('.tabbar').getBoundingClientRect();
      const cs = getComputedStyle(document.getElementById('socialNav'));
      return { navPos: cs.position, navBottom: nav.bottom, barTop: bar.top, vh: window.innerHeight };
    });
    expect(r.navPos).toBe('fixed');
    /* la barre sociale est collée juste au-dessus de la tabbar */
    expect(Math.abs(r.navBottom - r.barTop)).toBeLessThanOrEqual(2);
  });

  test('l’onglet actif suit la vue (Home → Reels → Home)', async ({ page }) => {
    await mockApi(page, { posts: [post(0, ME.id, { kind: 'photo', image_path: 'u/r.webp' })], people: [ME_P] });
    await openFeed(page);

    await expect(page.locator('#socialNav [data-view="home"]')).toHaveClass(/active/);
    await expect(page.locator('#socialNav [data-view="reels"]')).not.toHaveClass(/active/);

    await page.locator('#socialNav [data-view="reels"]').click();
    await expect(page.locator('#view-reels')).toBeVisible();
    await expect(page.locator('#socialNav [data-view="reels"]')).toHaveClass(/active/);
    await expect(page.locator('#socialNav [data-view="home"]')).not.toHaveClass(/active/);

    await page.locator('#socialNav [data-view="home"]').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#socialNav [data-view="home"]')).toHaveClass(/active/);
  });

  test('Create (+) ouvre le choix du type de publication', async ({ page }) => {
    const errs = consoleWatch(page);
    await mockApi(page, { posts: [], people: [ME_P] });
    await openFeed(page);

    await page.locator('#socialCreate').click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await expect(page.locator('#asList .as-item').first()).toBeVisible();
    /* fermer */
    await page.locator('#actionSheet .as-cancel .as-item').click();
    await expect(page.locator('#actionSheet')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test('la cloche de notifications est dans la barre du haut du Feed', async ({ page }) => {
    await mockApi(page, { posts: [], people: [ME_P] });
    await openFeed(page);
    await expect(page.locator('#notifBtn')).toBeVisible();
    await expect(page.locator('.feed-top #notifBtn')).toHaveCount(1);
  });
});

/* ------------------------------------------------------------------
   Timeline : la grille d'exploration du clone (timeline_page.dart) —
   mosaïque 3 colonnes de posts photo, atteinte par l'icône Explore du
   header (la nav basse n'a pas de slot libre : Search/Inbox sont
   verrouillés par les tests).
   ------------------------------------------------------------------ */
test.describe('Timeline : grille d’exploration', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
    await page.route('**/img916.test/**', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"></svg>'
    }));
  });

  async function seedExplore(page){
    await mockApi(page, {
      posts: [
        post(0, ME.id, { kind: 'photo', image_path: 'https://img916.test/tl0.svg' }),
        post(1, ME.id, { kind: 'photo', image_path: 'https://img916.test/tl1.svg' }),
        post(2, ME.id, { kind: 'photo', image_path: 'https://img916.test/tl2.svg' }),
        post(3, ME.id, { body: 'texte seul, sans image' })
      ],
      people: [ME_P]
    });
    await openFeed(page);
  }

  test('l’icône Explore ouvre la grille 3 colonnes (posts photo seulement)', async ({ page }) => {
    const errs = consoleWatch(page);
    await seedExplore(page);

    await page.locator('#exploreBtn').click();
    await expect(page.locator('#view-timeline')).toBeVisible();
    await expect(page.locator('#socialTitle')).toHaveText('Timeline');
    await expect(page.locator('.tl-grid')).toHaveCount(1);
    await expect(page.locator('.tl-tile')).toHaveCount(3);     /* le post texte est exclu */
    await expect(page.locator('#feedBackBtn')).toBeVisible();  /* bouton ‹ hors Home */
    expect(errs).toEqual([]);
  });

  test('tap sur une vignette → ouvre la publication (commentaires)', async ({ page }) => {
    const errs = consoleWatch(page);
    await seedExplore(page);
    await page.locator('#exploreBtn').click();
    await expect(page.locator('.tl-tile')).toHaveCount(3);

    await page.locator('.tl-tile').first().click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('la barre de recherche de la timeline mène à la recherche', async ({ page }) => {
    const errs = consoleWatch(page);
    await seedExplore(page);
    await page.locator('#exploreBtn').click();
    await expect(page.locator('#view-timeline')).toBeVisible();

    await page.locator('.tl-search').click();
    await expect(page.locator('#view-search')).toBeVisible();
    await expect(page.locator('#searchList')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('‹ retour depuis la timeline → Home', async ({ page }) => {
    const errs = consoleWatch(page);
    await seedExplore(page);
    await page.locator('#exploreBtn').click();
    await expect(page.locator('#view-timeline')).toBeVisible();

    await page.locator('#feedBackBtn').click();
    await expect(page.locator('#view-home')).toBeVisible();
    expect(errs).toEqual([]);
  });
});
