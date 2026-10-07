const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, ME_P, ANA_P, withSocial, signedIn, consoleWatch,
  openFeed, post, story, mockApi } = require('./social-mock');

const ALLOWED_KEYS = ['at_lastUser', 'at_profiles', 'at_tab', 'at_v2_Mouataz', 'at_v2_Mouataz_t'];

const PNG = {
  name: 'leg.png', mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64')
};

const TRACK = {
  trackId: 1234567890, trackName: 'Neon Skyline', artistName: 'The Lifters',
  collectionName: 'Iron Age', artworkUrl100: 'https://cdn.example/art.jpg',
  previewUrl: 'https://cdn.example/preview.m4a', trackTimeMillis: 30000
};

/* iTunes est hors origine : on le route pour rester deterministe. */
async function routeMusic(page){
  await page.route('**/itunes.apple.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ results: [TRACK] })
  }));
}

async function addMusic(page){
  await page.locator('#musicInput').fill('neon');
  await page.locator('#musicSearchBtn').click();
  await expect(page.locator('#musicList .music-row')).toHaveCount(1);
  await page.locator('#musicList .music-add').click();
  await expect(page.locator('#musicModal')).toBeHidden();
}

test.describe('V4 : « + » = choix du type de publication', () => {

  test('le bouton flottant ouvre Story, Note et Music', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);

    await openFeed(page);
    await page.locator('#newPostFab').click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await expect(page.locator('#asList')).toContainText('Photo');
    await expect(page.locator('#asList')).toContainText('Music');
    await page.locator('#asList .as-item', { hasText: 'Story' }).click();
    await expect(page.locator('#storyModal')).toBeVisible();

    await page.evaluate(() => closeModal('storyModal'));
    await page.locator('#newPostFab').click();
    await page.locator('#asList .as-item', { hasText: 'Note' }).click();
    await expect(page.locator('#noteModal')).toBeVisible();

    await page.evaluate(() => closeModal('noteModal'));
    await page.locator('#newPostFab').click();
    await page.locator('#asList .as-item', { hasText: 'Music' }).click();
    await expect(page.locator('#musicModal')).toBeVisible();
    await page.evaluate(() => closeMusicPicker());
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : upvote des publications', () => {

  test('le bouton like devient un upvote (▲), compteur et état actif', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    const up = page.locator('#feedList [data-act="like"]').first();
    await expect(up).toContainText('Upvote');
    await expect(up.locator('.post-act-ico')).toHaveText('▲');
    await expect(up).toHaveAttribute('aria-label', 'Upvote');

    const n = up.locator('[data-n="likes"]');
    await expect(n).toHaveText('0');
    await up.click();
    await expect(n).toHaveText('1');
    await expect(up).toHaveClass(/on/);
    expect(api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/likes'))).toBeTruthy();

    await page.locator('#feedList [data-act="like"]').first().click();
    await expect(page.locator('#feedList [data-act="like"]').first()).not.toHaveClass(/on/);
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : durée des notes et des stories', () => {

  test('note : 7 jours puis « forever »', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openNoteComposer());
    await expect(page.locator('#noteModal')).toBeVisible();

    await page.locator('#noteDur [data-dur="7"]').click();
    await expect(page.locator('#noteDur [data-dur="7"]')).toHaveClass(/active/);
    await page.locator('#noteBody').fill('Seven days of legs');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();
    await expect.poll(() => api.st.notes.length).toBe(1);
    const week = (Date.parse(api.st.notes[0].expires_at) - Date.now()) / 86400000;
    expect(week).toBeGreaterThan(6.9);
    expect(week).toBeLessThan(7.1);

    await page.evaluate(() => openNoteComposer());
    await page.locator('#noteDur [data-dur="0"]').click();
    await page.locator('#noteBody').fill('Here for good');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();
    await expect.poll(() => api.st.notes.length).toBe(1);
    const forever = (Date.parse(api.st.notes[0].expires_at) - Date.now()) / (365 * 86400000);
    expect(forever).toBeGreaterThan(50);
    expect(errs).toEqual([]);
  });

  test('story : 3 jours au choix', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openStoryComposer());
    await expect(page.locator('#storyModal')).toBeVisible();

    await page.locator('#storyDur [data-dur="3"]').click();
    await page.locator('#storyBody').fill('Three day story');
    await page.locator('#storySubmit').click();
    await expect(page.locator('#storyModal')).toBeHidden();
    await expect.poll(() => api.st.stories.length).toBe(1);

    const days = (Date.parse(api.st.stories[0].expires_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : compte privé / public', () => {

  test('le fil masque un compte privé non suivi, le follow ouvre tout', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, {
      people: [Object.assign({}, ANA_P, { is_private: true }), ME_P],
      posts: [post(0, ANA, { body: 'Secret session' }),
              post(1, ME.id, { body: 'Public session' })]
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(1);
    await expect(page.locator('#feedList')).toContainText('Public session');
    await expect(page.locator('#feedList')).not.toContainText('Secret session');

    /* profil : badge + grille verrouillée tant qu'on ne suit pas */
    await page.evaluate(id => openProfile(id), ANA);
    await expect(page.locator('#view-profile')).toBeVisible();
    await expect(page.locator('#profName')).toHaveText('Ana');
    await expect(page.locator('#profPriv')).toBeVisible();
    await expect(page.locator('#profGrid')).toContainText('This account is private');
    await expect(page.locator('#profGrid .ptile')).toHaveCount(0);

    /* on suit Ana : le post entre dans le fil, la grille se déverrouille */
    api.st.follows.push({ follower_id: ME.id, followee_id: ANA });
    await page.evaluate(() => renderFeed());
    await expect(page.locator('#feedList .post')).toHaveCount(2);
    await expect(page.locator('#feedList')).toContainText('Secret session');

    await page.evaluate(() => renderProfile());
    await expect(page.locator('#profPriv')).toBeVisible();
    await expect(page.locator('#profGrid .ptile')).toHaveCount(1);
    expect(errs).toEqual([]);
  });

  test('basculer mon compte en privé dans « Edit profile »', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, { people: [ME_P, ANA_P] });

    await openFeed(page);
    await page.locator('#socialNav [data-view="profile"]').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await page.locator('#editProfileBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();

    const sw = page.locator('#editPrivate');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await page.locator('#editPrivate').click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.locator('#profileSubmit').click();
    await expect(page.locator('#profileModal')).toBeHidden();

    const patches = api.calls.filter(c => c.method === 'PATCH' &&
      c.url.includes('/rest/v1/profiles'));
    expect(patches.length).toBeGreaterThan(0);
    const wrotePrivacy = patches.some(c => {
      const b = JSON.parse(c.body || '{}');
      return String(b.bio || '').indexOf('⁣private⁣') >= 0 || b.is_private === true;
    });
    expect(wrotePrivacy).toBe(true);
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : musique', () => {

  test('recherche, ajout au post, pion dans le corps, chip dans le fil', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#postMusicBtn').click();
    await expect(page.locator('#musicModal')).toBeVisible();
    await addMusic(page);

    await expect(page.locator('#postMusicSlot')).toBeVisible();
    await expect(page.locator('#postMusicSlot .mchip-t')).toHaveText('Neon Skyline');

    await page.locator('#postBody').fill('Big pull day');
    await page.locator('#postSubmit').click();
    await expect.poll(() => api.st.posts.length).toBe(3);
    expect(api.st.posts[0].body).toBe('Big pull day ♪1234567890');

    const chip = page.locator('#feedList .post-music .mchip').first();
    await expect(chip).toBeVisible();
    await expect(chip.locator('.mchip-t')).toHaveText('Neon Skyline');
    await expect(chip.locator('[data-mplay]')).toHaveCount(1);
    await expect(page.locator('#postMusicSlot')).toBeHidden();

    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(ALLOWED_KEYS);
    expect(errs).toEqual([]);
  });

  test('une note garde la musique dans ses 60 caractères', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openNoteComposer());
    await page.locator('#noteMusicBtn').click();
    await addMusic(page);
    await expect(page.locator('#noteMusicSlot')).toBeVisible();

    await page.locator('#noteBody').fill('Legs are sore from the squats today');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();
    await expect.poll(() => api.st.notes.length).toBe(1);

    const body = api.st.notes[0].body;
    expect(body.endsWith('♪1234567890')).toBe(true);
    expect(body.length).toBeLessThanOrEqual(60);

    await expect(page.locator('#notesRow .note-music .mchip-t')).toHaveText('Neon Skyline');
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : éditeur d’image avant publication', () => {

  test('annuler l’édition ne met rien dans le composeur', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.setInputFiles('#postPhoto', PNG);
    await expect(page.locator('#editorModal')).toBeVisible();
    await expect(page.locator('#editorPresets .seg').first()).toHaveClass(/active/);

    await page.locator('#editorPresets [data-preset="mono"]').click();
    await expect(page.locator('#editorPresets [data-preset="mono"]')).toHaveClass(/active/);
    await page.locator('#editorAspect [data-aspect="4:5"]').click();
    await expect(page.locator('#editorAspect [data-aspect="4:5"]')).toHaveClass(/active/);

    await page.locator('#editorCancel').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#postPreview')).toBeHidden();
    expect(api.calls.filter(c => c.method !== 'GET')).toEqual([]);
    expect(errs).toEqual([]);
  });
});
