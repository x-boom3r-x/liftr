/* Chantier : Reels (layout du clone) — feed vertical plein écran
   d'images, rail d'actions, like + burst, comments, follow, menu
   propriétaire. Les posts SANS image ne deviennent pas de reels. */
const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, ME_P, ANA_P, withSocial, signedIn, openFeed, post,
  mockApi, consoleWatch } = require('./social-mock');

function photo(i, authorId, over){
  return post(i, authorId, Object.assign({
    kind: 'photo',
    image_path: 'u/reel-' + i + '.webp',
    thumb_path: 'u/reel-' + i + '-thumb.webp'
  }, over || {}));
}

test.describe('Reels : feed plein écran', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
  });

  test('les posts image deviennent des reels plein écran (les textes non)', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [
        photo(0, ME.id, { body: 'Front squat reel' }),
        photo(1, ANA, { body: 'Ana deadlift reel' }),
        post(2, ME.id, { body: 'just text, no image' })
      ],
      people: [ANA_P, ME_P]
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(3);

    await page.locator('#socialNav [data-view="reels"]').click();
    await expect(page.locator('#view-reels')).toBeVisible();
    await expect(page.locator('#view-home')).toBeHidden();

    /* 2 images → 2 reels ; le post texte est exclu */
    await expect(page.locator('#reelsList .reel')).toHaveCount(2);
    const img = page.locator('.reel .reel-img').first();
    await expect(img).toHaveAttribute('src', /\/storage\/v1\/object\/public\/posts\/u\/reel-0\.webp$/);
    /* rail d'actions + auteur + caption + audio ; follow seulement sur
       le reel d'Ana (on ne suit pas son propre reel) */
    await expect(page.locator('.reel .reel-rail .reel-like')).toHaveCount(2);
    await expect(page.locator('.reel .reel-follow')).toHaveCount(1);
    await expect(page.locator('.reel[data-post="post-1"] .reel-follow')).toHaveText('Follow');
    await expect(page.locator('.reel .reel-caption').first()).toContainText('Front squat reel');
    await expect(page.locator('.reel .reel-audio .mchip').first()).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('tap sur le media = like optimiste + burst, compteur incrémente', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [photo(0, ANA, { body: 'Ana reel' })],
      people: [ANA_P, ME_P]
    });

    await openFeed(page);
    await page.locator('#socialNav [data-view="reels"]').click();
    await expect(page.locator('#reelsList .reel')).toHaveCount(1);

    const like = page.locator('.reel .reel-like').first();
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.reel .reel-like [data-n="likes"]')).toHaveText('0');

    await page.locator('.reel .reel-media').first().click();
    await expect(page.locator('.reel-burst')).toHaveCount(1);
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toHaveClass(/on/);
    await expect(page.locator('.reel .reel-like [data-n="likes"]')).toHaveText('1');
    expect(errs).toEqual([]);
  });

  test('bouton comments ouvre la modale de commentaires', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [photo(0, ME.id)],
      people: [ME_P]
    });

    await openFeed(page);
    await page.locator('#socialNav [data-view="reels"]').click();
    await expect(page.locator('#reelsList .reel')).toHaveCount(1);

    await page.locator('.reel .reel-comment').first().click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('suivre / ne plus suivre un auteur depuis un reel', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [photo(0, ANA, { body: 'Ana reel' })],
      people: [ANA_P, ME_P]
    });

    await openFeed(page);
    await page.locator('#socialNav [data-view="reels"]').click();
    const follow = page.locator('.reel .reel-follow').first();
    await expect(follow).toHaveText('Follow');

    await follow.click();
    await expect(follow).toHaveText('Following');
    await expect(follow).toHaveClass(/on/);
    expect(errs).toEqual([]);
  });

  test('menu ⋯ visible seulement pour le propriétaire ; auteur non propriétaire masqué', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [photo(0, ME.id), photo(1, ANA)],
      people: [ANA_P, ME_P]
    });

    await openFeed(page);
    await page.locator('#socialNav [data-view="reels"]').click();
    await expect(page.locator('#reelsList .reel')).toHaveCount(2);

    /* reel 0 = moi → ⋯ présent ; reel 1 = Ana → pas de ⋯ */
    await expect(page.locator('.reel[data-post="post-0"] .reel-more')).toHaveCount(1);
    await expect(page.locator('.reel[data-post="post-1"] .reel-more')).toHaveCount(0);
    expect(errs).toEqual([]);
  });

  test('retour à Home puis Reels à nouveau : pas d’erreur console', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, { posts: [photo(0, ME.id)], people: [ME_P] });

    await openFeed(page);
    await page.locator('#socialNav [data-view="reels"]').click();
    await expect(page.locator('#view-reels')).toBeVisible();

    await page.locator('#socialNav [data-view="home"]').click();
    await expect(page.locator('#view-home')).toBeVisible();

    await page.locator('#socialNav [data-view="reels"]').click();
    await expect(page.locator('#view-reels')).toBeVisible();
    await expect(page.locator('#reelsList .reel')).toHaveCount(1);
    expect(errs).toEqual([]);
  });
});
