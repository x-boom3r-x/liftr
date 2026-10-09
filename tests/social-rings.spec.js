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
