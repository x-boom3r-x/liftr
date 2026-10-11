const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, withSocial, signedIn, consoleWatch,
  openFeed, post, mockApi } = require('./social-mock');

/* Chantier G : ♥ like, ▲▼ votes, ⟲ reposts, 🔖 save, ↗ share.
   Tout est optimiste (compteur + état immédiats), rollback + toast
   en cas d'échec réseau, aria-pressed partout. */

const ACTIONS = ['up', 'down', 'like', 'reply', 'repost', 'save', 'share'];

function scrollOverflow(page){
  return page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('Chantier G : votes, reposts, saves, partage', () => {

  test('rangée d’actions complète, sans débordement de 320 à 430 px', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });
    await openFeed(page);

    const foot = page.locator('#feedList .post-foot').first();
    await expect(foot).toBeVisible();
    for (const act of ACTIONS){
      await expect(foot.locator('[data-act="' + act + '"]')).toHaveCount(1);
    }
    /* ⋯ (menu) vit dans l'en-tête de la carte — une seule occurrence */
    const card = page.locator('#feedList .post').first();
    await expect(card.locator('.post-head [data-act="menu"]')).toHaveCount(1);
    await expect(card.locator('.post-foot [data-act="menu"]')).toHaveCount(0);

    for (const width of [320, 390, 430]){
      await page.setViewportSize({ width: width, height: 780 });
      await expect(foot.locator('[data-act="save"]')).toBeVisible();
      const box = await foot.boundingBox();
      expect(box.width, 'foot at ' + width + 'px').toBeLessThanOrEqual(width);
      expect(await scrollOverflow(page), 'overflow at ' + width + 'px').toBeLessThanOrEqual(0);
    }
    expect(errs).toEqual([]);
  });

  test('vote ▲ : optimiste, actif, upsert puis re-clique retire', async ({ page }) => {
    const api = mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    const up = page.locator('#feedList [data-act="up"]').first();
    const score = page.locator('#feedList [data-n="votes"]').first();
    await expect(score).toHaveText('0');

    await up.click();
    await expect(score).toHaveText('1');
    await expect(up).toHaveClass(/on/);
    await expect(up).toHaveAttribute('aria-pressed', 'true');
    const upsert = api.calls.filter(c =>
      c.method === 'POST' && c.url.includes('/rest/v1/post_votes') && String(c.body).includes('"value":1'));
    expect(upsert.length).toBeGreaterThanOrEqual(1);

    await up.click();
    await expect(score).toHaveText('0');
    await expect(up).not.toHaveClass(/on/);
    await expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(api.calls.some(c => c.method === 'DELETE' && c.url.includes('/rest/v1/post_votes'))).toBe(true);
  });

  test('vote ▼ : bascule depuis ▲, score négatif, re-clique retire', async ({ page }) => {
    const api = mockApi(page, { posts: [post(0, ME.id)] });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    const up = page.locator('#feedList [data-act="up"]').first();
    const down = page.locator('#feedList [data-act="down"]').first();
    const score = page.locator('#feedList [data-n="votes"]').first();

    await up.click();
    await expect(score).toHaveText('1');
    await down.click();
    await expect(score).toHaveText('-1');
    await expect(down).toHaveClass(/on/);
    await expect(up).not.toHaveClass(/on/);
    const body = api.calls.filter(c =>
      c.method === 'POST' && c.url.includes('/rest/v1/post_votes')).pop();
    expect(String(body.body)).toContain('"value":-1');

    await down.click();
    await expect(score).toHaveText('0');
    await expect(down).not.toHaveClass(/on/);
  });

  test('échec réseau du vote : retour arrière + toast', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, { posts: [post(0, ME.id)] });
    /* enregistré après mockApi : l'emporte, fallback → mock pour le reste */
    await page.route('**/rest/v1/post_votes**', route => {
      if (route.request().method() === 'POST'){
        return route.fulfill({ status: 500, contentType: 'application/json',
          body: JSON.stringify({ message: 'boom' }) });
      }
      return route.fallback();
    });
    void api;
    await openFeed(page);

    const up = page.locator('#feedList [data-act="up"]').first();
    const score = page.locator('#feedList [data-n="votes"]').first();
    await up.click();
    await expect(score).toHaveText('0');
    await expect(up).not.toHaveClass(/on/);
    await expect(up).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#toast')).toContainText('boom');
  });

  test('double-tap : like + burst, jamais un unlike', async ({ page }) => {
    const api = mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    const body = page.locator('#feedList .post-body').first();
    const like = page.locator('#feedList [data-act="like"]').first();

    await body.dblclick();
    await expect(like).toHaveClass(/on/);
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like.locator('[data-n="likes"]')).toHaveText('1');
    await expect(page.locator('#feedList .like-burst')).toHaveCount(1);
    expect(api.calls.some(c => c.method === 'POST' && c.url.includes('/rest/v1/likes'))).toBe(true);

    /* second double-tap après le cooldown : le like reste, pas d'unlike */
    await page.waitForTimeout(500);
    await body.dblclick();
    await expect(like).toHaveClass(/on/);
    await expect(like.locator('[data-n="likes"]')).toHaveText('1');
    expect(api.calls.filter(c => c.method === 'DELETE' && c.url.includes('/rest/v1/likes')).length).toBe(0);
  });

  test('repost : feuille, écriture, en-tête chez les abonnés', async ({ page }) => {
    const api = mockApi(page, {
      posts: [post(0, ME.id), post(1, ANA)],
      follows: [{ follower_id: ME.id, followee_id: ANA,
        created_at: new Date().toISOString() }],
      reposts: [{ post_id: 'post-0', user_id: ANA, quote: 'Try this!',
        created_at: new Date(Date.now() - 60000).toISOString() }]
    });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    /* le repost d'Ana est fusionné au fil avec son en-tête */
    await expect(page.locator('#feedList .post-repost')).toHaveCount(1);
    await expect(page.locator('#feedList .post-repost-by')).toContainText('Ana reposted');
    await expect(page.locator('#feedList .post-repost-quote')).toContainText('Try this!');

    /* repost simple via la feuille */
    const rp = page.locator('#feedList [data-act="repost"][data-post="post-1"]');
    await rp.click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await expect(page.locator('#asList')).toContainText('Repost with comment');
    await page.locator('#asList .as-item', { hasText: /^Repost$/ }).click();
    await expect.poll(() => api.st.reposts.filter(r => r.post_id === 'post-1').length).toBe(1);
    expect(api.st.reposts.filter(r => r.post_id === 'post-1')[0].user_id).toBe(ME.id);
    const btn = page.locator('#feedList [data-act="repost"][data-post="post-1"]').first();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#toast')).toContainText('Reposted');
  });

  test('repost interdit : son propre post, puis deux fois le même', async ({ page }) => {
    const api = mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    /* son propre post : toast, aucune feuille, aucune écriture */
    await page.locator('#feedList [data-act="repost"][data-post="post-0"]').click();
    await expect(page.locator('#toast')).toContainText('cannot repost your own post');
    await expect(page.locator('#actionSheet')).toBeHidden();
    expect(api.st.reposts.length).toBe(0);

    /* repost valide puis re-essai bloqué (le repost rejoint le fil : 2 cartes post-1) */
    await page.locator('#feedList [data-act="repost"][data-post="post-1"]').first().click();
    await page.locator('#asList .as-item', { hasText: /^Repost$/ }).click();
    await expect.poll(() => api.st.reposts.length).toBe(1);
    await page.locator('#feedList [data-act="repost"][data-post="post-1"]').first().click();
    await expect(page.locator('#toast')).toContainText('already reposted');
    await expect(page.locator('#actionSheet')).toBeHidden();
    expect(api.st.reposts.length).toBe(1);
  });

  test('repost avec commentaire : quote envoyée, aucun post créé', async ({ page }) => {
    const api = mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    await page.locator('#feedList [data-act="repost"][data-post="post-1"]').click();
    await page.locator('#asList .as-item', { hasText: 'Repost with comment' }).click();
    await expect(page.locator('#repostBanner')).toBeVisible();
    await expect(page.locator('#repostBanner')).toContainText('Reposting');

    await page.locator('#postBody').fill('Insane volume!');
    await page.locator('#postSubmit').click();
    await expect.poll(() => api.st.reposts.filter(r => r.quote === 'Insane volume!').length).toBe(1);
    await expect(page.locator('#repostBanner')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('Reposted with your comment');
    expect(api.calls.some(c =>
      c.method === 'POST' && /\/rest\/v1\/posts(\?|$)/.test(c.url))).toBe(false);
  });

  test('save privé : optimiste, onglet Saved, aucune notification', async ({ page }) => {
    const api = mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    const save = page.locator('#feedList [data-act="save"]').nth(1);
    await save.click();
    await expect(save).toHaveClass(/on/);
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#toast')).toContainText('only you can see it');
    expect(api.st.saves.length).toBe(1);

    /* l'onglet Saved du profil (le mien) affiche le post enregistré */
    await page.locator('#socialNav [data-view="profile"]').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await page.locator('[data-ptab="saved"]').click();
    await expect(page.locator('#profGridSaved .ptile')).toHaveCount(1);
    expect(api.calls.some(c => c.url.includes('/rest/v1/notifications'))).toBe(false);

    /* re-cliquer retire du fil */
    await openFeed(page);
    const save2 = page.locator('#feedList [data-act="save"]').nth(1);
    await save2.click();
    await expect(save2).not.toHaveClass(/on/);
    await expect(page.locator('#toast')).toContainText('Removed from Saved');
    expect(api.st.saves.length).toBe(0);
  });

  test('partage sans navigator.share : copier le lien / envoyer en message', async ({ page }) => {
    await page.addInitScript(() => {
      try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch(e){}
    });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });
    await openFeed(page);

    await page.locator('#feedList [data-act="share"]').first().click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await expect(page.locator('#asList')).toContainText('Copy link');
    await page.locator('#asList .as-item', { hasText: 'Send in message' }).click();
    await expect(page.locator('#view-inbox')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('Link copied');
  });

  test('onglet Top : tri par score pondéré par l’âge, sans reposts', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      posts: [
        post(0, ANA, { created_at: new Date(Date.now() - 2 * 3600000).toISOString() }),
        post(1, ANA, { created_at: new Date(Date.now() - 48 * 3600000).toISOString() })
      ],
      votes: [
        { post_id: 'post-1', user_id: ANA, value: 1 },
        { post_id: 'post-1', user_id: '33333333-3333-4333-8333-333333333333', value: 1 }
      ],
      reposts: [{ post_id: 'post-1', user_id: ANA, quote: null,
        created_at: new Date().toISOString() }]
    });
    await openFeed(page);

    await page.locator('#feedFilter [data-scope="top"]').click();
    await expect(page.locator('#feedFilter [data-scope="top"]')).toHaveClass(/active/);
    /* post-1 : 2 votes / (48+2)^1.5 > post-0 : 0 → il passe devant malgré son âge */
    await expect(page.locator('#feedList .post').first()).toHaveAttribute('data-post', 'post-1');
    /* les reposts sont exclus du scope Top */
    await expect(page.locator('#feedList .post-repost')).toHaveCount(0);
  });

  test('0 erreur console sur toutes les interactions G', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      posts: [post(0, ME.id), post(1, ANA)],
      follows: [{ follower_id: ME.id, followee_id: ANA,
        created_at: new Date().toISOString() }]
    });
    await openFeed(page);

    await page.locator('#feedList [data-act="like"][data-post="post-1"]').click();
    await page.locator('#feedList [data-act="up"][data-post="post-1"]').click();
    await page.locator('#feedList [data-act="down"][data-post="post-1"]').click();
    await page.locator('#feedList [data-act="save"][data-post="post-1"]').click();
    await page.locator('#feedList [data-act="repost"][data-post="post-1"]').click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await page.locator('#actionSheet .as-cancel .as-item').click();
    await expect(page.locator('#actionSheet')).toBeHidden();
    await page.locator('#feedFilter [data-scope="top"]').click();
    await expect(page.locator('#feedList .post').first()).toBeVisible();
    await page.locator('#feedFilter [data-scope="all"]').click();
    await expect(page.locator('#feedList .post').first()).toBeVisible();
    await page.waitForTimeout(600);
    expect(errs).toEqual([]);
  });

});
