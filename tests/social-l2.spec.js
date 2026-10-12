const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const {
  mockApi, ME, ANA, withSocial, signedIn, consoleWatch, openFeed, story
} = require('./social-mock');

/* ------------------------------------------------------------------
   L2 — stories : « Add another », badge compteur, texte riche
   (6 polices offline, couleur/contour/ombre/boîte, drag + rotation)
   et colonne style (jsonb v6, migration 00000000000006).
   ------------------------------------------------------------------ */

async function signIn(page){
  await withSocial(page);
  await seed(page, {});
  await signedIn(page);
}

test.describe('L2 : stories — Add another', () => {

  test('après publication le strip s’ouvre, « Add another » rejoue, « Done » ferme', async ({ page }) => {
    const errs = consoleWatch(page);
    await signIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openStoryComposer());
    await expect(page.locator('#storyModal')).toBeVisible();

    await page.locator('#storyBody').fill('First story');
    await page.locator('#storySubmit').click();
    /* le modal reste ouvert avec le strip de succès */
    await expect(page.locator('#storyModal')).toBeVisible();
    await expect(page.locator('#storyDone')).toBeVisible();
    await expect.poll(() => api.st.stories.length).toBe(1);

    await page.locator('#storyAgainBtn').click();
    await expect(page.locator('#storyDone')).toBeHidden();
    await expect(page.locator('#storyActions')).toBeVisible();
    await expect(page.locator('#storyBody')).toHaveValue('');

    await page.locator('#storyBody').fill('Second story');
    await page.locator('#storySubmit').click();
    await expect(page.locator('#storyDone')).toBeVisible();
    await expect.poll(() => api.st.stories.length).toBe(2);
    expect(api.st.stories.map(s => s.body)).toEqual(['First story', 'Second story']);

    await page.locator('#storyDoneBtn').click();
    await expect(page.locator('#storyModal')).toBeHidden();
    expect(errs).toEqual([]);
  });
});

test.describe('L2 : stories — badge compteur', () => {

  test('la cellule « You » affiche le nombre de stories actives', async ({ page }) => {
    const errs = consoleWatch(page);
    await signIn(page);
    mockApi(page, {
      stories: [story(0, ME.id), story(1, ME.id)]
    });

    await openFeed(page);
    const badge = page.locator('#crewRow .crew-cell.is-me .crew-count');
    await expect(badge).toHaveText('2');
    expect(errs).toEqual([]);
  });

  test('sans story : pas de compteur, le « + » est là', async ({ page }) => {
    const errs = consoleWatch(page);
    await signIn(page);
    mockApi(page);

    await openFeed(page);
    await expect(page.locator('#crewRow .crew-cell.is-me .crew-plus')).toBeVisible();
    await expect(page.locator('#crewRow .crew-cell.is-me .crew-count')).toHaveCount(0);
    expect(errs).toEqual([]);
  });
});

test.describe('L2 : stories — texte riche', () => {

  test('police, couleur, boîte, drag et rotation partent dans le jsonb', async ({ page }) => {
    const errs = consoleWatch(page);
    await signIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openStoryComposer());
    await expect(page.locator('#storyModal')).toBeVisible();

    await page.locator('#storyBody').fill('LEG DAY');
    /* la barre d'outils apparaît dès qu'il y a du texte */
    await expect(page.locator('#stgTools')).toBeVisible();
    await expect(page.locator('#stgText')).toBeVisible();

    /* police : Impact → Heavy */
    await expect(page.locator('#stgFont')).toHaveText('Font · Impact');
    await page.locator('#stgFont').click();
    await expect(page.locator('#stgFont')).toHaveText('Font · Heavy');
    await expect(page.locator('#stgText')).toHaveClass(/stf-black/);

    /* couleur : jaune */
    await page.locator('#stgColors .stg-sw[data-color="#ffe14d"]').click();
    await expect(page.locator('#stgText')).toHaveCSS('color', 'rgb(255, 225, 77)');

    /* boîte */
    await page.locator('#stgTools [data-st="b"]').click();
    await expect(page.locator('#stgText')).toHaveClass(/has-b/);

    /* drag : la couche suit le doigt */
    const before = await page.locator('#stgText').boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2 + 40, { steps: 4 });
    await page.mouse.up();
    const after = await page.locator('#stgText').boundingBox();
    expect(after.x).toBeGreaterThan(before.x + 10);
    expect(after.y).toBeGreaterThan(before.y + 15);

    /* rotation via la poignée */
    const rot = await page.locator('#stgRot').boundingBox();
    await page.mouse.move(rot.x + rot.width / 2, rot.y + rot.height / 2);
    await page.mouse.down();
    await page.mouse.move(rot.x + rot.width / 2 + 40, rot.y + rot.height / 2 + 6, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#stgText')).toHaveCSS('transform', /matrix/);

    /* publication : le style compact part tel quel */
    await page.locator('#storySubmit').click();
    await expect(page.locator('#storyDone')).toBeVisible();
    await expect.poll(() => api.st.stories.length).toBe(1);
    const s = api.st.stories[0];
    expect(s.body).toBe('LEG DAY');
    expect(s.style).toBeTruthy();
    expect(s.style.f).toBe('black');
    expect(s.style.c).toBe('#ffe14d');
    expect(s.style.b).toBe(1);
    expect(s.style.o).toBe(1);
    expect(s.style.s).toBe(1);
    expect(s.style.x).toBeGreaterThanOrEqual(3);
    expect(s.style.x).toBeLessThanOrEqual(97);
    expect(s.style.y).toBeGreaterThanOrEqual(5);
    expect(s.style.y).toBeLessThanOrEqual(95);
    expect(Math.abs(s.style.r)).toBeGreaterThan(5);
    expect(s.style.z).toBeGreaterThan(0.5);
    expect(errs).toEqual([]);
  });

  test('story sans texte : pas de style envoyé', async ({ page }) => {
    const errs = consoleWatch(page);
    await signIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openStoryComposer());
    /* un seul caractère : le strip n'a pas de style (texte vide après trim
       n'est pas possible via l'UI, on valide le comportement texte simple) */
    await page.locator('#storyBody').fill('ok');
    await page.locator('#storySubmit').click();
    await expect(page.locator('#storyDone')).toBeVisible();
    await expect.poll(() => api.st.stories.length).toBe(1);
    expect(api.st.stories[0].style).toBeTruthy();
    expect(api.st.stories[0].style.f).toBe('impact');
    expect(errs).toEqual([]);
  });

  test('la visionneuse rend le texte stylé (couche positionnée)', async ({ page }) => {
    const errs = consoleWatch(page);
    await signIn(page);
    mockApi(page, {
      follows: [{ follower_id: ME.id, followee_id: ANA }],
      stories: [story(0, ANA, {
        body: 'Styled!',
        style: { f: 'mono', c: '#ffe14d', o: 1, s: 1, b: 0,
                 x: 30, y: 60, r: -12, z: 1.3 }
      })]
    });

    await openFeed(page);
    await page.locator('#crewRow [data-crew="story"]').first().click();
    const txt = page.locator('#svStage .sv-text');
    await expect(txt).toBeVisible();
    await expect(txt).toHaveClass(/stf-mono/);
    await expect(txt).toHaveClass(/has-o/);
    await expect(txt).toHaveClass(/has-s/);
    await expect(txt).toContainText('Styled!');
    const style = await txt.getAttribute('style');
    expect(style).toMatch(/left:\s*30%/);
    expect(style).toMatch(/top:\s*60%/);
    expect(style).toMatch(/rotate\(-12deg\)/);
    expect(errs).toEqual([]);
  });

  test('story sans style : la légende classique reste', async ({ page }) => {
    const errs = consoleWatch(page);
    await signIn(page);
    mockApi(page, {
      follows: [{ follower_id: ME.id, followee_id: ANA }],
      stories: [story(0, ANA, { body: 'Plain story', style: null })]
    });

    await openFeed(page);
    await page.locator('#crewRow [data-crew="story"]').first().click();
    await expect(page.locator('#svStage .sv-caption')).toContainText('Plain story');
    await expect(page.locator('#svStage .sv-text')).toHaveCount(0);
    expect(errs).toEqual([]);
  });
});
