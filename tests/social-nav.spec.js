/* Social keeps internal destinations in the title menu and uses the app's
   single root navigation. The feed composer stays inline. */
const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ME_P, withSocial, signedIn, openFeed, mockApi, post, consoleWatch } =
  require('./social-mock');

test.describe('Navigation basse (layout clone)', () => {

  async function chooseSection(page, label){
    await page.locator('.feed-top-title').click();
    await page.locator('#actionSheet .as-item').filter({ hasText: label }).click();
  }

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
  });

  test('une seule barre racine; les destinations Social sont dans le menu du titre', async ({ page }) => {
    await mockApi(page, { posts: [], people: [ME_P] });
    await openFeed(page);

    await expect(page.locator('#socialNav')).toBeHidden();
    await expect(page.locator('#tb .tab')).toHaveCount(3);
    await chooseSection(page, 'Search people');
    await expect(page.locator('#view-search')).toBeVisible();
  });

  test('aucune seconde barre fixe ou flottante n’est affichée dans Social', async ({ page }) => {
    await mockApi(page, { posts: [], people: [ME_P] });
    await openFeed(page);
    await expect(page.locator('#socialNav')).toBeHidden();
    await expect(page.locator('#tb')).toBeVisible();
    await expect(page.locator('#newPostFab')).toHaveCount(0);
  });

  test('le menu permet de passer de Home à Reels puis de revenir', async ({ page }) => {
    await mockApi(page, { posts: [post(0, ME.id, { kind: 'photo', image_path: 'u/r.webp' })], people: [ME_P] });
    await openFeed(page);

    await chooseSection(page, 'Reels');
    await expect(page.locator('#view-reels')).toBeVisible();
    await chooseSection(page, 'Home feed');
    await expect(page.locator('#view-home')).toBeVisible();
  });

  test('le composeur de publication reste dans le fil, sans bouton + flottant', async ({ page }) => {
    const errs = consoleWatch(page);
    await mockApi(page, { posts: [], people: [ME_P] });
    await openFeed(page);

    await expect(page.locator('#composer')).toBeVisible();
    await expect(page.locator('#newPostFab')).toHaveCount(0);
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
