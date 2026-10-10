const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, ME_P, ANA_P, withSocial, signedIn, consoleWatch,
  openFeed, post, story, mockApi } = require('./social-mock');

const PNG = {
  name: 'me.png', mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64')
};

async function goProfile(page){
  await openFeed(page);
  await page.locator('#socialNav [data-view="profile"]').click();
  await expect(page.locator('#view-profile')).toBeVisible();
  await expect(page.locator('#profName')).toHaveText('Mouataz');
}

test.describe('V3 : profil, suppression de post, photo de profil', () => {

  test('grille du profil : les photos des posts s’affichent', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      posts: [post(0, ME.id, { kind: 'photo', body: '', image_path: 'me/session-1.webp', thumb_path: 'me/session-1_thumb.webp' })]
    });

    await goProfile(page);
    await expect(page.locator('#statPosts')).toHaveText('1');
    const tile = page.locator('#profGrid .ptile').first();
    await expect(tile).toBeVisible();
    await expect(tile.locator('img')).toBeVisible();
    expect(await tile.locator('img').getAttribute('src')).toContain('session-1.webp');
    expect(errs).toEqual([]);
  });

  test('grille du profil : ma tuile ouvre les actions, celle des autres les commentaires', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });

    await goProfile(page);
    await expect(page.locator('#profGrid .ptile')).toHaveCount(1);

    await page.locator('#profGrid .ptile').first().click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await expect(page.locator('#asList')).toContainText('Delete post');
    await page.locator('#actionSheet .as-cancel .as-item').click();
    await expect(page.locator('#actionSheet')).toBeHidden();

    await page.evaluate(id => window.openProfile(id), ANA);
    await expect(page.locator('#profName')).toHaveText('Ana');
    await expect(page.locator('#profGrid .ptile')).toHaveCount(1);
    await page.locator('#profGrid .ptile').first().click();
    await expect(page.locator('#actionSheet')).toBeHidden();
    await expect(page.locator('#commentsModal')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('tuile photo d\'un autre profil : le post (photo) s\'affiche au-dessus des commentaires', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      posts: [post(1, ANA, { kind: 'photo', body: '',
        image_path: 'ana/session-push.webp', thumb_path: 'ana/session-push_thumb.webp' })]
    });
    /* la photo du post (route apres mockApi = prioritaire) */
    await page.route('**/session-push.webp', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"></svg>'
    }));

    await goProfile(page);   /* ouvre l'onglet Feed + la vue profil (meme profil) */
    await page.evaluate(id => window.openProfile(id), ANA);
    await expect(page.locator('#profName')).toHaveText('Ana');
    await page.locator('#profGrid .ptile').first().click();
    await expect(page.locator('#commentsModal')).toBeVisible();

    /* le post doit etre visible : corps + photo, pas la liste seule */
    const cp = page.locator('#commentsPost');
    await expect(cp).toBeVisible();
    await expect(cp.locator('img.cpost-img')).toBeVisible();
    expect(await cp.locator('img.cpost-img').getAttribute('src')).toContain('session-push.webp');
    /* l'auteur du profil rendu est stamp (display_name du profil) */
    await expect(cp.locator('.post-name')).toHaveText('Ana');
    expect(errs).toEqual([]);
  });

  test('supprimer mon post depuis la grille du profil', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, { posts: [post(0, ME.id), post(1, ME.id)] });

    await goProfile(page);
    await expect(page.locator('#profGrid .ptile')).toHaveCount(2);
    await expect(page.locator('#statPosts')).toHaveText('2');

    await page.locator('#profGrid .ptile').first().click();
    await page.locator('#asList .as-item', { hasText: 'Delete post' }).click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#cfOk').click();

    await expect(page.locator('#profGrid .ptile')).toHaveCount(1);
    await expect(page.locator('#statPosts')).toHaveText('1');
    await expect.poll(() => api.st.posts.length).toBe(1);
    expect(api.calls.some(c => c.method === 'DELETE' && c.url.includes('/rest/v1/posts'))).toBe(true);
    expect(errs).toEqual([]);
  });

  test('feed : le menu ⋯ n’apparaît que sur mes posts et supprime', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, { posts: [post(0, ME.id), post(1, ANA)] });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(2);
    await expect(page.locator('#feedList .post-more')).toHaveCount(1);

    await page.locator('#feedList .post-more').click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await page.locator('#asList .as-item', { hasText: 'Delete post' }).click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#cfOk').click();

    await expect(page.locator('#feedList .post')).toHaveCount(1);
    await expect.poll(() => api.st.posts.length).toBe(1);
    expect(errs).toEqual([]);
  });

  test('photo de profil : nouvel envoi = nouveau chemin (pas de cache)', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);

    const OLD = 'https://demo-project.supabase.co/storage/v1/object/public/avatars/' +
      ME.id + '/avatar.jpg';
    const api = mockApi(page, {
      people: [{ ...ME_P, avatar_url: OLD }, ANA_P]
    });

    await goProfile(page);
    await page.locator('#editProfileBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();

    await page.locator('#editAvatarFile').setInputFiles(PNG);
    /* la photo passe par l'éditeur (carré + masque rond) avant l'aperçu */
    await expect(page.locator('#editorModal')).toBeVisible();
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#editAvatarPreview img')).toBeVisible();
    await page.locator('#profileSubmit').click();
    await expect(page.locator('#profileModal')).toBeHidden();

    const upload = api.calls.find(c => c.method !== 'GET' &&
      /\/storage\/v1\/object\/avatars\//.test(c.url) && c.url.includes('avatar-'));
    expect(upload).toBeTruthy();

    const patch = api.calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/profiles'));
    expect(patch).toBeTruthy();
    const url = JSON.parse(patch.body).avatar_url;
    expect(url).toContain('/avatars/');
    expect(url).toContain('avatar-');
    expect(url).not.toBe(OLD);
    /* en base : URL propre, sans cache-buster (le `?v=` est local au DOM) */
    expect(url).not.toContain('?');

    await page.reload();
    await signedIn(page);
    await goProfile(page);
    await expect(page.locator('#profAvatarBtn img')).toBeVisible();
    expect(await page.locator('#profAvatarBtn img').getAttribute('src')).toContain('avatar-');
    expect(errs).toEqual([]);
  });

  test('nav Profile ramène sur mon profil, même après un autre profil', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {});

    await openFeed(page);
    await page.evaluate(id => window.openProfile(id), ANA);
    await expect(page.locator('#profName')).toHaveText('Ana');

    await page.locator('#socialNav [data-view="profile"]').click();
    await expect(page.locator('#profName')).toHaveText('Mouataz');
    await expect(page.locator('#editProfileBtn')).toBeVisible();
    await expect(page.locator('#profBack')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test("retour du profil : vers l'écran précédent, jamais sur mon profil", async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {});

    /* ouvert depuis Home → retour à Home */
    await openFeed(page);
    await page.evaluate(id => window.openProfile(id), ANA);
    await expect(page.locator('#profName')).toHaveText('Ana');
    await expect(page.locator('#profBack')).toBeVisible();
    await page.locator('#profBack').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#view-profile')).toBeHidden();

    /* ouvert depuis Search → retour à Search */
    await page.locator('#socialNav [data-view="search"]').click();
    await expect(page.locator('#view-search')).toBeVisible();
    await page.evaluate(id => window.openProfile(id), ANA);
    await expect(page.locator('#profBack')).toBeVisible();
    await page.locator('#profBack').click();
    await expect(page.locator('#view-search')).toBeVisible();

    /* mon profil : aucun bouton retour */
    await page.locator('#socialNav [data-view="profile"]').click();
    await expect(page.locator('#profName')).toHaveText('Mouataz');
    await expect(page.locator('#profBack')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test('photo de profil en grand sur le profil des autres', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const AV = 'https://demo-project.supabase.co/storage/v1/object/public/avatars/' +
      ANA + '/avatar-1.jpg';
    const api = mockApi(page, { people: [{ ...ANA_P, avatar_url: AV }, ME_P] });

    await openFeed(page);
    await page.evaluate(id => window.openProfile(id), ANA);
    await expect(page.locator('#profAvatarBtn img')).toBeVisible();
    await expect(page.locator('#profAvatarBtn'))
      .toHaveAttribute('aria-label', 'View profile photo');

    await page.locator('#profAvatarBtn').click();
    await expect(page.locator('#avatarView')).toBeVisible();
    expect(await page.locator('#avatarViewImg').getAttribute('src')).toBe(AV);
    expect(await page.locator('#avatarViewName').textContent()).toBe('@ana');

    await page.keyboard.press('Escape');
    await expect(page.locator('#avatarView')).toBeHidden();

    /* pas de photo : rien ne s'ouvre, juste un toast */
    api.st.people = [{ ...ANA_P, avatar_url: null }, ME_P];
    await page.evaluate(id => window.openProfile(id), ANA);
    await expect(page.locator('#profAvatarBtn img')).toHaveCount(0);
    await page.locator('#profAvatarBtn').click();
    await expect(page.locator('#avatarView')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('No profile photo yet.');

    /* mon profil : la photo ouvre l'édition, pas la visionneuse */
    await page.locator('#socialNav [data-view="profile"]').click();
    await expect(page.locator('#profName')).toHaveText('Mouataz');
    await page.locator('#profAvatarBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();
    await expect(page.locator('#avatarView')).toBeHidden();
    expect(errs).toEqual([]);
  });
});

test.describe('V3 : stories (24 h)', () => {

  test('la visionneuse joue ma story et la marque vue', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, { stories: [ story(0, ME.id, { body: 'Leg day PR' }) ] });

    await openFeed(page);
    const cell = page.locator('#crewRow .crew-cell[data-crew="story"]').first();
    await expect(cell).toHaveClass(/live/);
    await cell.click();

    await expect(page.locator('#storyView')).toHaveClass(/show/);
    await expect(page.locator('#svName')).toHaveText('Mouataz');
    await expect(page.locator('#svStage .sv-caption')).toContainText('Leg day PR');
    await expect(page.locator('#svProgress .sv-seg')).toHaveCount(1);
    await expect(page.locator('#svDelete')).toBeVisible();
    await expect.poll(() => api.st.story_views.length, { timeout: 4000 }).toBe(1);

    await page.locator('.sv-close').click();
    await expect(page.locator('#storyView')).not.toHaveClass(/show/);
    await expect(cell).toHaveClass(/seen/);
    expect(errs).toEqual([]);
  });

  test('creer une story texte depuis la rang�e', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#crewRow [data-crew="compose"]').click();
    await expect(page.locator('#storyModal')).toBeVisible();

    await page.locator('#storyBody').fill('New PR today');
    await page.locator('#storySubmit').click();
    await expect(page.locator('#storyModal')).toBeHidden();

    await expect.poll(() => api.st.stories.length).toBe(1);
    expect(api.st.stories[0].body).toBe('New PR today');
    await expect(page.locator('#crewRow [data-crew="story"]')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('supprimer ma story depuis la visionneuse', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, { stories: [ story(0, ME.id, { body: 'Scraps' }) ] });

    await openFeed(page);
    await page.locator('#crewRow .crew-cell[data-crew="story"]').first().click();
    await expect(page.locator('#storyView')).toHaveClass(/show/);

    await page.locator('#svDelete').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#cfOk').click();

    await expect.poll(() => api.st.stories.length).toBe(0);
    await expect(page.locator('#storyView')).not.toHaveClass(/show/);
    expect(errs).toEqual([]);
  });

  test('photo de story : URL depuis le bucket stories (pas posts)', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      stories: [ story(0, ME.id, { body: 'Leg day', image_path: ME.id + '/123-abc.jpg' }) ]
    });
    /* l'objet existe : on sert une vraie image à la place du JSON factice */
    await page.route('**/storage/v1/object/public/stories/**', route => route.fulfill({
      status: 200, contentType: 'image/png', body: PNG.buffer
    }));

    await openFeed(page);
    await page.locator('#crewRow .crew-cell[data-crew="story"]').first().click();
    await expect(page.locator('#storyView')).toHaveClass(/show/);

    const img = page.locator('#svStage .sv-img');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toContain('/storage/v1/object/public/stories/');
    expect(src).toContain('/123-abc.jpg');
    expect(src).not.toContain('/object/public/posts/');

    /* l'image se charge vraiment : pas de retrait d'erreur */
    await page.waitForTimeout(400);
    await expect(img).toBeVisible();
    expect(errs).toEqual([]);
  });
});

test.describe('V3 : notes au-dessus des messages', () => {

  test('partager puis retirer ma note', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, {
      convos: [{ id: 'conv-1', user_a: ME.id, user_b: ANA, last_message_at: new Date().toISOString() }]
    });

    await openFeed(page);
    await page.locator('#socialNav [data-view="inbox"]').click();
    await expect(page.locator('#view-inbox')).toBeVisible();
    await expect(page.locator('#notesRow')).toBeVisible();
    await expect(page.locator('#notesRow .note-bubble').first()).toContainText('+ Note');

    await page.locator('#notesRow [data-note="me"]').click();
    await expect(page.locator('#noteModal')).toBeVisible();
    await page.locator('#noteBody').fill('Sore legs today');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();

    await expect.poll(() => api.st.notes.length).toBe(1);
    expect(api.st.notes[0].body).toBe('Sore legs today');
    await expect(page.locator('#notesRow .note-bubble').first()).toContainText('Sore legs');

    await page.locator('#notesRow [data-note="me"]').click();
    await expect(page.locator('#noteRemove')).toBeVisible();
    await page.locator('#noteRemove').click();
    await expect.poll(() => api.st.notes.length).toBe(0);
    await expect(page.locator('#notesRow .note-bubble').first()).toContainText('+ Note');
    expect(errs).toEqual([]);
  });

  test('la note d�un peer ouvre sa conversation', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const now = new Date().toISOString();
    mockApi(page, {
      convos: [{ id: 'conv-1', user_a: ME.id, user_b: ANA, last_message_at: now }],
      notes: [{ id: 'note-1', author_id: ANA, body: 'Pull day',
        created_at: now, updated_at: now,
        expires_at: new Date(Date.now() + 86400000).toISOString(), author: ANA_P }]
    });

    await openFeed(page);
    await page.locator('#socialNav [data-view="inbox"]').click();
    await expect(page.locator('#notesRow .note-cell')).toHaveCount(2);
    await expect(page.locator('#notesRow .note-bubble').nth(1)).toContainText('Pull day');

    await page.locator('#notesRow [data-note="peer"]').click();
    await expect(page.locator('#view-thread')).toBeVisible();
    await expect(page.locator('#threadName')).toHaveText('Ana');
    expect(errs).toEqual([]);
  });
});

test.describe('V3 : gestion du compte', () => {

  const SESSION = {
    access_token: 'fake-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'fake-refresh-token',
    user: {
      id: ME.id, aud: 'authenticated', role: 'authenticated',
      email: 'mouataz@liftr-smoke.dev',
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name: 'Mouataz' },
      identities: [], is_anonymous: false
    }
  };

  /* Session valide en localStorage + endpoints GoTrue interceptes.
     mockApi est enregistre AVANT (donc l'auth route l'emporte sur /**). */
  async function withAuth(page, api){
    await page.evaluate(s => {
      try { localStorage.setItem('liftr-auth', JSON.stringify(s)); } catch(e){}
    }, SESSION);
    const seen = [];
    await page.route('**/*.supabase.co/auth/v1/**', async route => {
      const body = route.request().postData() || '';
      seen.push({ url: route.request().url(), method: route.request().method(), body: body });
      let email = SESSION.user.email;
      try { const j = JSON.parse(body); if (j && j.email) email = j.email; } catch(e){}
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(Object.assign({}, SESSION.user, { email: email }))
      });
    });
    return seen;
  }

  test('email et mot de passe depuis le panneau du compte', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    const api = mockApi(page);
    const auth = await withAuth(page, api);
    await signedIn(page, SESSION.user);

    await goProfile(page);
    await page.locator('#editProfileBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();
    await expect(page.locator('#acctEmail')).toHaveValue('mouataz@liftr-smoke.dev');
    await expect(page.locator('#acctDelete')).toBeVisible();

    await page.locator('#acctEmail').fill('not-an-email');
    await page.locator('#acctEmailSave').click();
    await expect(page.locator('#acctError')).toContainText('does not look right');

    await page.locator('#acctEmail').fill('mouataz@newmail.dev');
    await page.locator('#acctEmailSave').click();
    await expect(page.locator('#acctError')).toBeHidden();
    await expect.poll(() => auth.filter(c => c.method === 'PUT' && c.url.includes('/user')).length).toBe(1);
    expect(JSON.parse(auth.filter(c => c.method === 'PUT').pop().body).email).toBe('mouataz@newmail.dev');

    await page.locator('#acctPass').fill('short');
    await page.locator('#acctPassSave').click();
    await expect(page.locator('#acctError')).toContainText('at least 8 characters');

    await page.locator('#acctPass').fill('longenough1');
    await page.locator('#acctPassSave').click();
    await expect(page.locator('#acctPass')).toHaveValue('');
    await expect.poll(() => auth.filter(c => c.method === 'PUT' && c.url.includes('/user')).length).toBe(2);
    expect(errs).toEqual([]);
  });

  test('supprimer le compte appelle la RPC', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    const api = mockApi(page);
    await withAuth(page, api);
    await signedIn(page, SESSION.user);

    await goProfile(page);
    await page.locator('#editProfileBtn').click();
    await page.locator('#acctDelete').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await expect(page.locator('#cfMsg')).toContainText('cannot be undone');
    await page.locator('#cfOk').click();

    await expect.poll(() => api.calls.filter(c =>
      c.url.includes('/rest/v1/rpc/delete_my_account')).length, { timeout: 5000 }).toBe(1);
    await expect(page.locator('#toast')).toContainText('deleted');
  });
});
