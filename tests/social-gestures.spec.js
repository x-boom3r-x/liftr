/* Chantier E — gestes : swipe retour / fermeture.
   Pointer events synthétiques (comme le pinch du chantier C) : la lib
   gestures.js fonctionne sur pointerdown/move/up, sans tactile réel. */
const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, ME_P, ANA_P, withSocial, signedIn, consoleWatch,
  openFeed, story, mockApi } = require('./social-mock');

const PNG = {
  name: 'me.png', mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64')
};
const ANA_ID = ANA;

async function setup(page, opts){
  const errs = consoleWatch(page);
  await withSocial(page);
  await seed(page, { programme: [], history: [] }, 'Mouataz');
  await signedIn(page);
  await page.route('**/img916.test/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"></svg>'
  }));
  await page.route('**/img45.test/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"></svg>'
  }));
  mockApi(page, opts || {});
  await openFeed(page);
  return errs;
}

/* swipe synthétique : down → 6 moves → up (dt ≈ 0 → vélocité haute) */
function swipe(page, sel, dx, dy, x0, y0){
  return page.evaluate(([sel, dx, dy, x0, y0]) => {
    const el = document.querySelector(sel);
    const mk = (x, y, t) => el.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      isPrimary: true, clientX: x, clientY: y }));
    mk(x0, y0, 'pointerdown');
    for (let i = 1; i <= 6; i++) mk(x0 + dx * i / 6, y0 + dy * i / 6, 'pointermove');
    mk(x0 + dx, y0 + dy, 'pointerup');
  }, [sel, dx, dy, x0 == null ? 200 : x0, y0 == null ? 300 : y0]);
}

test.describe('E : gestes — swipe retour / fermeture', () => {

  test('story : swipe vers le bas ferme la visionneuse', async ({ page }) => {
    const errs = await setup(page, {
      stories: [story(0, ANA, { image_path: 'https://img916.test/s.svg' })],
      people: [ANA_P]
    });
    await page.evaluate(id => window.openStoryViewer(id), ANA_ID);
    await page.locator('#svStage .sv-img').waitFor({ state: 'visible' });
    await expect(page.locator('#storyView')).toHaveClass(/show/);

    await swipe(page, '#storyView', 0, 220);
    await expect(page.locator('#storyView')).not.toHaveClass(/show/);
    expect(errs).toEqual([]);
  });

  test('story : swipe gauche = auteur suivant, droite = précédent', async ({ page }) => {
    const errs = await setup(page, {
      follows: [{ follower_id: ME.id, followee_id: ANA }],
      stories: [
        story(0, ANA, { image_path: 'https://img916.test/s.svg' }),
        story(1, ME.id, { image_path: 'https://img45.test/s.svg' })
      ],
      people: [ANA_P, ME_P]
    });
    await page.evaluate(id => window.openStoryViewer(id), ANA_ID);
    await page.locator('#svStage .sv-img').waitFor({ state: 'visible' });
    await expect(page.locator('#svName')).toHaveText('Ana');

    await swipe(page, '#storyView', -200, 0);
    await expect(page.locator('#svName')).toHaveText('Mouataz');

    await swipe(page, '#storyView', 200, 0);
    await expect(page.locator('#svName')).toHaveText('Ana');
    expect(errs).toEqual([]);
  });

  test('story : appui long = pause (le slide ne défile pas)', async ({ page }) => {
    test.slow();
    const errs = await setup(page, {
      stories: [
        story(0, ANA, { image_path: 'https://img916.test/s.svg' }),
        story(1, ANA, { body: 'Second', created_at: new Date().toISOString(),
          image_path: 'https://img45.test/s.svg' })
      ],
      people: [ANA_P]
    });
    await page.evaluate(id => window.openStoryViewer(id), ANA_ID);
    await page.locator('#svStage .sv-img').waitFor({ state: 'visible' });
    const src0 = await page.evaluate(() =>
      document.getElementById('svStage').style.getPropertyValue('--sv-src'));

    /* pointerdown maintenu 5,6 s (> SLIDE_MS = 5 s) : sans pause le slide
       avancerait et --sv-src changerait. */
    await page.evaluate(() => new Promise(res => {
      const el = document.getElementById('storyView');
      const mk = (x, y, t) => el.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
        isPrimary: true, clientX: x, clientY: y }));
      mk(200, 300, 'pointerdown');
      setTimeout(() => { mk(200, 300, 'pointerup'); res(); }, 5600);
    }));
    const src1 = await page.evaluate(() =>
      document.getElementById('svStage').style.getPropertyValue('--sv-src'));
    expect(src1, 'slide figé pendant l’appui long').toBe(src0);
    expect(errs).toEqual([]);
  });

  test('modale : le grabber suit le doigt et ferme (storyModal)', async ({ page }) => {
    const errs = await setup(page);
    await page.evaluate(() => window.openStoryComposer());
    await expect(page.locator('#storyModal')).toHaveClass(/show/);

    await swipe(page, '#storyModal .grabber', 0, 200);
    await expect(page.locator('#storyModal')).not.toHaveClass(/show/);
    expect(errs).toEqual([]);
  });

  test('éditeur : swipe bas depuis l’en-tête = annuler', async ({ page }) => {
    const errs = await setup(page, { posts: [] });
    await page.setInputFiles('#postPhoto', PNG);
    await expect(page.locator('#editorModal')).toBeVisible();
    await page.locator('#editorStage canvas, #editorStage img').first().waitFor({ state: 'visible' });

    await swipe(page, '#editorModal .editor-top', 0, 200);
    await expect(page.locator('#editorModal')).not.toHaveClass(/show/);
    expect(errs).toEqual([]);
  });

  test('edge-back : le swipe du bord ferme la couche du dessus (profil d’un autre)', async ({ page }) => {
    const errs = await setup(page, { people: [ANA_P, ME_P] });
    await page.evaluate(id => window.openProfile(id), ANA_ID);
    await expect(page.locator('#view-profile')).toBeVisible();
    await expect(page.locator('#profName')).toHaveText('Ana');

    /* départ en x = 12 (bord gauche, largeur 24) → retour historique */
    await swipe(page, 'body', 180, 0, 12, 400);
    await expect(page.locator('#view-profile')).toBeHidden();
    await expect(page.locator('#view-home')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('edge-back : sans couche empilée, le geste ne fait rien', async ({ page }) => {
    const errs = await setup(page, { people: [ANA_P] });
    await expect(page.locator('#view-home')).toBeVisible();

    await swipe(page, 'body', 180, 0, 12, 400);
    await expect(page.locator('#view-home')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('history.back() ferme la story sans quitter l’app', async ({ page }) => {
    const errs = await setup(page, {
      stories: [story(0, ANA, { image_path: 'https://img916.test/s.svg' })],
      people: [ANA_P]
    });
    await page.evaluate(id => window.openStoryViewer(id), ANA_ID);
    await expect(page.locator('#storyView')).toHaveClass(/show/);

    await page.evaluate(() => history.back());
    await expect(page.locator('#storyView')).not.toHaveClass(/show/);
    await expect(page.locator('#tab-feed')).toBeVisible();
    expect(errs).toEqual([]);
  });
});
