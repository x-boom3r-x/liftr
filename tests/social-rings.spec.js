/* Chantier B : les avatars (post, profil, commentaires) portent
   has-story / seen, pilotés par le Set unique de js/social/rings.js,
   rafraîchi toutes les 60 s, au retour en avant-plan, et après
   publication / suppression d'une story. Sans story active : aucun
   dégradé (css/app.css ne peint que .has-story). */
const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, ME_P, ANA_P, withSocial, signedIn, openFeed, post, story,
  mockApi, consoleWatch } = require('./social-mock');

const FOLLOWS = [{ follower_id: ME.id, followee_id: ANA }];
const FOREVER = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString();

test.describe('Chantier B : anneaux has-story sur les avatars', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
  });

  function avatarState(page, uid){
    return page.evaluate(id => {
      const av = document.querySelector('.post-avatar[data-uid="' + id + '"]');
      if (!av) return null;
      return { has: av.classList.contains('has-story'), seen: av.classList.contains('seen') };
    }, uid);
  }

  test("un post d'un auteur avec story active : anneau has-story", async ({ page }) => {
    mockApi(page, {
      posts: [post(0, ANA), post(1, ME.id)],
      follows: FOLLOWS,
      stories: [story(0, ANA)],
      people: [ANA_P, ME_P]
    });
    await openFeed(page);
    await page.waitForTimeout(400);

    const ana = await avatarState(page, ANA);
    expect(ana, 'avatar d\'Ana trouvé dans le feed').not.toBeNull();
    expect(ana.has, 'Ana a une story active → has-story').toBe(true);
    expect(ana.seen, 'pas encore vue → pas de seen').toBe(false);

    const me = await avatarState(page, ME.id);
    expect(me.has, 'moi sans story → pas de has-story').toBe(false);
  });

  test("story déjà vue : has-story + seen", async ({ page }) => {
    mockApi(page, {
      posts: [post(0, ANA)],
      follows: FOLLOWS,
      stories: [story(0, ANA)],
      story_views: [{ story_id: 'story-0', viewer_id: ME.id }],
      people: [ANA_P, ME_P]
    });
    await openFeed(page);
    await page.waitForTimeout(400);

    const ana = await avatarState(page, ANA);
    expect(ana.has).toBe(true);
    expect(ana.seen, 'story déjà vue → seen').toBe(true);
  });

  test("expiration : refreshStoryRings retire l'anneau et la rangée", async ({ page }) => {
    const api = mockApi(page, {
      posts: [post(0, ANA)],
      follows: FOLLOWS,
      stories: [story(0, ANA)],
      people: [ANA_P, ME_P]
    });
    await openFeed(page);
    await page.waitForTimeout(400);
    expect((await avatarState(page, ANA)).has, 'story active avant expiration').toBe(true);

    /* la story passe à terme : le rafraîchissement doit tout nettoyer */
    api.st.stories[0].expires_at = new Date(Date.now() - 1000).toISOString();
    await page.evaluate(() => window.refreshStoryRings(true));
    await page.waitForTimeout(400);

    expect((await avatarState(page, ANA)).has,
      'story expirée → plus de has-story').toBe(false);
    const liveLeft = await page.evaluate(() =>
      !!document.querySelector('#crewRow .crew-cell.live'));
    expect(liveLeft, 'la rangée ne montre plus de story live').toBe(false);
  });

  test("profil : l'avatar de la cible porte has-story", async ({ page }) => {
    mockApi(page, {
      posts: [post(0, ANA)],
      follows: FOLLOWS,
      stories: [story(0, ANA)],
      people: [ANA_P, ME_P]
    });
    await openFeed(page);
    await page.waitForTimeout(400);
    await page.evaluate(id => window.openProfile(id), ANA);
    await page.waitForTimeout(400);

    const r = await page.evaluate(() => {
      const av = document.getElementById('profAvatarBtn');
      return av ? { has: av.classList.contains('has-story'),
                    seen: av.classList.contains('seen'),
                    uid: av.getAttribute('data-uid') } : null;
    });
    expect(r, 'avatar de profil trouvé').not.toBeNull();
    expect(r.uid, 'prof-av porte data-uid').toBe(ANA);
    expect(r.has, 'profil avec story → has-story').toBe(true);
  });

  test("zéro erreur console sur le parcours anneaux (feed + profil)", async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [post(0, ANA)],
      follows: FOLLOWS,
      stories: [story(0, ANA)],
      story_views: [{ story_id: 'story-0', viewer_id: ME.id }],
      people: [ANA_P, ME_P]
    });
    await openFeed(page);
    await page.waitForTimeout(300);
    await page.evaluate(id => window.openProfile(id), ANA);
    await page.waitForTimeout(300);
    expect(errs, 'aucune erreur console').toEqual([]);
  });
});

test.describe('Chantier B : cellules You / Find et Set des stories actives', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
  });

  test("You / Find : anneau transparent, badge + toujours visible", async ({ page }) => {
    mockApi(page, { posts: [], people: [ME_P] });
    await openFeed(page);
    await page.waitForTimeout(400);

    const r = await page.evaluate(() => {
      const g = sel => {
        const e = document.querySelector(sel);
        return e ? getComputedStyle(e).backgroundColor : null;
      };
      return {
        me: g('.crew-cell.is-me .crew-ring'),
        find: g('.crew-find .crew-ring'),
        plus: !!document.querySelector('.crew-cell.is-me .crew-plus')
      };
    });
    expect(r.me, 'pastille You sans story : fond transparent').toBe('rgba(0, 0, 0, 0)');
    expect(r.find, 'pastille Find : fond transparent').toBe('rgba(0, 0, 0, 0)');
    expect(r.plus, 'le badge + reste affiché').toBe(true);
  });

  test("Set : story expirée = pas d anneau ; Forever (+100 ans) = anneau", async ({ page }) => {
    const api = mockApi(page, {
      posts: [post(0, ANA)],
      follows: FOLLOWS,
      stories: [story(0, ANA, { expires_at: new Date(Date.now() - 1000).toISOString() })],
      people: [ANA_P, ME_P]
    });
    await openFeed(page);
    await page.waitForTimeout(400);

    let ana = await page.evaluate(id => {
      const av = document.querySelector('.post-avatar[data-uid="' + id + '"]');
      return av ? av.classList.contains('has-story') : null;
    }, ANA);
    expect(ana, 'story déjà expirée : pas de has-story').toBe(false);

    /* même story, date « forever » (+100 ans) : l'anneau doit apparaître */
    api.st.stories[0].expires_at = FOREVER;
    await page.evaluate(() => window.refreshStoryRings(true));
    await page.waitForTimeout(400);
    ana = await page.evaluate(id => {
      const av = document.querySelector('.post-avatar[data-uid="' + id + '"]');
      return av ? av.classList.contains('has-story') : null;
    }, ANA);
    expect(ana, 'story Forever : has-story posé').toBe(true);
  });

  test("publication puis suppression : l'anneau apparaît puis disparaît", async ({ page }) => {
    const api = mockApi(page, { posts: [post(0, ME.id)], people: [ME_P] });
    await openFeed(page);
    await page.waitForTimeout(400);

    const meRing = () => page.evaluate(id => {
      const av = document.querySelector('.post-avatar[data-uid="' + id + '"]');
      return av ? av.classList.contains('has-story') : null;
    }, ME.id);
    expect(await meRing(), 'sans story : pas de anneau').toBe(false);

    /* publication */
    await page.locator('#crewRow [data-crew="compose"]').click();
    await page.locator('#storyBody').fill('Fresh story');
    await page.locator('#storySubmit').click();
    await expect(page.locator('#storyModal')).toBeHidden();
    await expect.poll(() => api.st.stories.length).toBe(1);
    await page.waitForTimeout(400);
    expect(await meRing(), 'après publication : anneau posé').toBe(true);

    /* suppression via la visionneuse */
    await page.locator('#crewRow .crew-cell[data-crew="story"]').first().click();
    await expect(page.locator('#storyView')).toHaveClass(/show/);
    await page.locator('#svDelete').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#cfOk').click();
    await expect.poll(() => api.st.stories.length).toBe(0);
    await page.waitForTimeout(400);
    expect(await meRing(), 'après suppression : anneau retiré').toBe(false);
  });
});

test.describe('Chantier B : profil accessible depuis commentaires et story', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
  });

  test("commentaire : clic sur l'avatar ou le nom ouvre le profil", async ({ page }) => {
    const CMT = {
      id: 'c1', post_id: 'post-0', author_id: ANA, body: 'Nice lift',
      created_at: new Date().toISOString(), deleted_at: null,
      author: { id: ANA, username: 'ana', display_name: 'Ana', avatar_url: null }
    };
    mockApi(page, {
      posts: [post(0, ANA)],
      follows: FOLLOWS,
      comments: [CMT],
      people: [ANA_P, ME_P]
    });
    await openFeed(page);
    await page.waitForTimeout(300);
    await page.locator('.post[data-post="post-0"] [data-act="reply"]').click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    await page.locator('.comment-avatar[data-uid="' + ANA + '"]').click();
    await expect(page.locator('#commentsModal')).toBeHidden();
    await expect(page.locator('#profAvatarBtn')).toBeVisible();
    expect(await page.locator('#profAvatarBtn').getAttribute('data-uid')).toBe(ANA);

    /* reboucler : clic sur le nom */
    await page.evaluate(() => window.setSView('home'));
    await page.waitForTimeout(200);
    await page.locator('.post[data-post="post-0"] [data-act="reply"]').click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    await page.locator('.comment-name[data-uid="' + ANA + '"]').click();
    await expect(page.locator('#commentsModal')).toBeHidden();
    await expect(page.locator('#profAvatarBtn')).toBeVisible();
    expect(await page.locator('#profAvatarBtn').getAttribute('data-uid')).toBe(ANA);
  });

  test("visionneuse : l'en-tête ouvre le profil, .sv-close ferme seulement", async ({ page }) => {
    mockApi(page, {
      posts: [post(0, ANA)],
      follows: FOLLOWS,
      stories: [story(0, ANA)],
      people: [ANA_P, ME_P]
    });
    await openFeed(page);
    await page.waitForTimeout(300);

    await page.evaluate(id => window.openStoryViewer(id), ANA);
    await expect(page.locator('#storyView')).toHaveClass(/show/);
    await page.locator('#svProfile').click();
    await expect(page.locator('#storyView')).not.toHaveClass(/show/);
    await expect(page.locator('#profAvatarBtn')).toBeVisible();
    expect(await page.locator('#profAvatarBtn').getAttribute('data-uid')).toBe(ANA);

    /* .sv-close ferme la visionneuse sans ouvrir de profil */
    await page.evaluate(id => window.openStoryViewer(id), ANA);
    await expect(page.locator('#storyView')).toHaveClass(/show/);
    await page.locator('.sv-close').click();
    await expect(page.locator('#storyView')).not.toHaveClass(/show/);
    await expect(page.locator('#tab-feed')).toBeVisible();
  });
});

test.describe('Chantier B : rendu de la visionneuse (9:16, fond flou, safe-areas)', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
    /* deux images factices : 9:16 et 4:5 */
    await page.route('**/img916.test/**', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"></svg>'
    }));
    await page.route('**/img45.test/**', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"></svg>'
    }));
  });

  test(".is-916 sur du 9:16, pas sur du 4:5 ; .plain sans image ; --sv-src posé", async ({ page }) => {
    const api = mockApi(page, {
      posts: [post(0, ME.id)],
      stories: [story(0, ME.id, { image_path: 'https://img916.test/s.svg' })],
      people: [ME_P]
    });
    await openFeed(page);
    await page.evaluate(() => window.openStoryViewer());
    await page.locator('#svStage .sv-img').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);

    let st = await page.evaluate(() => {
      const s = document.getElementById('svStage');
      return { is916: s.classList.contains('is-916'), plain: s.classList.contains('plain'),
        src: s.style.getPropertyValue('--sv-src') };
    });
    expect(st.is916, 'image 9:16 → classe is-916').toBe(true);
    expect(st.plain, 'image présente → pas de plain').toBe(false);
    expect(st.src, '--sv-src alimenté pour le fond flou').toContain('img916.test');

    /* même story, image 4:5 : is-916 retiré, fond flou conservé */
    api.st.stories[0].image_path = 'https://img45.test/s.svg';
    await page.evaluate(() => window.closeStoryViewer());
    await page.evaluate(() => window.openStoryViewer());
    await page.locator('#svStage .sv-img').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    st = await page.evaluate(() => {
      const s = document.getElementById('svStage');
      return { is916: s.classList.contains('is-916'), src: s.style.getPropertyValue('--sv-src') };
    });
    expect(st.is916, 'image 4:5 → pas de is-916 (contain + fond flou)').toBe(false);
    expect(st.src).toContain('img45.test');

    /* story sans image : .plain, --sv-src effacé */
    api.st.stories[0].image_path = null;
    await page.evaluate(() => window.closeStoryViewer());
    await page.evaluate(() => window.openStoryViewer());
    await expect(page.locator('#svStage')).toHaveClass(/plain/);
    st = await page.evaluate(() => ({
      src: document.getElementById('svStage').style.getPropertyValue('--sv-src')
    }));
    expect(st.src, '--sv-src retiré sans image').toBe('');
  });

  test("safe-areas forcées (47/34) : progression sous l'encoche, aucun chevauchement", async ({ page }) => {
    mockApi(page, {
      posts: [post(0, ME.id)],
      stories: [story(0, ME.id, {
        body: 'Nice lift ♪1234567890',
        image_path: 'https://img916.test/s.svg'
      })],
      people: [ME_P]
    });
    await openFeed(page);
    await page.addStyleTag({ content: ':root{--safe-top:47px!important;--safe-bottom:34px!important}' });
    await page.evaluate(() => window.openStoryViewer());
    await page.locator('#svStage .sv-img').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);

    const m = await page.evaluate(() => {
      const rect = sel => {
        const e = document.querySelector(sel);
        return e ? e.getBoundingClientRect() : null;
      };
      const cap = document.querySelector('.sv-caption');
      let capText = null;
      if (cap){
        const range = document.createRange();
        range.selectNodeContents(cap);
        const b = range.getBoundingClientRect();
        capText = { top: b.top, bottom: b.bottom };
      }
      const prog = rect('#svProgress');
      const music = rect('.sv-music');
      const foot = rect('.story-view .sv-foot');
      return {
        prog: prog && { top: prog.top }, music: music && { top: music.top, bottom: music.bottom },
        foot: foot && { top: foot.top }, capText
      };
    });
    expect(m.prog, 'barre de progression présente').not.toBeNull();
    expect(m.prog.top, 'progression sous le safe-top (47px)').toBeGreaterThanOrEqual(47);
    expect(m.music, 'pastille musique présente').not.toBeNull();
    expect(m.foot, 'pied de page présent').not.toBeNull();
    expect(m.music.bottom, 'musique au-dessus du pied').toBeLessThanOrEqual(m.foot.top);
    expect(m.capText, 'légende présente').not.toBeNull();
    expect(m.capText.bottom, 'légende au-dessus du pied').toBeLessThanOrEqual(m.foot.top);
    expect(m.capText.top, 'légende sous la pastille musique').toBeGreaterThanOrEqual(m.music.bottom);
  });
});
