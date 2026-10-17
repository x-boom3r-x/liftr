const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const MOCK_CONFIG = { supabaseUrl: 'https://demo-project.supabase.co', anonKey: 'anon-key-for-tests', realtime: false };
const ALLOWED_KEYS = ['at_lastUser', 'at_profiles', 'at_tab', 'at_v2_Mouataz', 'at_v2_Mouataz_t'];

const ME = { id: '11111111-1111-4111-8111-111111111111', user_metadata: { name: 'Mouataz' } };
const ANA = '22222222-2222-4222-8222-222222222222';

const ME_P = {
  id: ME.id, username: 'mouataz', display_name: 'Mouataz',
  avatar_url: null, bio: 'Push · Pull · Legs', created_at: new Date().toISOString()
};
const ANA_P = {
  id: ANA, username: 'ana', display_name: 'Ana',
  avatar_url: null, bio: 'Push day', created_at: new Date(Date.now() - 86400000).toISOString()
};

function withSocial(page){
  return page.addInitScript(cfg => { window.LIFTR_SOCIAL_CONFIG = cfg; }, MOCK_CONFIG);
}

async function signedIn(page){
  await page.evaluate(u => Promise.resolve(window.restoreSession()).then(() => {
    window.socialUser = u;
    window.updateSocialGate();
  }), ME);
}

function consoleWatch(page){
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  return errs;
}

async function openFeed(page){
  await page.locator('#tabFeedBtn').click();
  await expect(page.locator('#tab-feed')).toBeVisible();
}

function post(i, authorId, over){
  return Object.assign({
    id: 'post-' + i,
    kind: 'text',
    body: 'Session ' + i,
    image_path: null,
    thumb_path: null,
    meta: {},
    created_at: new Date(Date.now() - i * 3600000).toISOString(),
    deleted_at: null,
    author_id: authorId || ME.id,
    author: authorId === ANA ? { id: ANA, username: 'ana', display_name: 'Ana', avatar_url: null }
                             : { id: ME.id, username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
  }, over || {});
}

/* Fake backend Supabase : rest + storage, avec filtres réels. */
function mockApi(page, opts){
  const st = Object.assign({
    posts: [post(0), post(1)],
    people: [ANA_P, ME_P],
    comments: [],
    follows: [],
    likes: [],
    convos: [],
    msgs: [],
    seq: 0
  }, opts || {});

  const calls = [];
  const json = (route, body, status) => route.fulfill({
    status: status || 200, contentType: 'application/json', body: JSON.stringify(body)
  });
  const header = (req, name) => String(req.headers()[name] || '');

  page.route('**/*.supabase.co/**', async route => {
    const req = route.request();
    const call = { url: req.url(), method: req.method().toUpperCase(), body: req.postData(), resource: req.url() };
    calls.push(call);

    if (!call.url.includes('/rest/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });

    const u = decodeURIComponent(call.url);
    const tm = u.match(/\/rest\/v1\/([a-z_]+)(\?|$|\/)/);
    const table = tm ? tm[1] : null;
    const method = call.method;
    const head = method === 'HEAD';

    /* count exact : PostgREST renvoie content-range. */
    const range = (total, prefix) => route.fulfill({
      status: 200, headers: { 'content-range': `${prefix ? prefix + '-' : ''}0-${Math.max(0, total - 1)}/${total}` },
      body: ''
    });

    /* ---------- posts ---------- */
    if (table === 'posts'){
      let rows = st.posts.filter(p => !p.deleted_at);
      const m = u.match(/author_id=in\.\(([^)]*)\)/);
      if (m){
        const ids = m[1].split(',').filter(Boolean);
        rows = rows.filter(p => ids.includes(p.author_id));
      }
      const am = u.match(/author_id=eq\.([^&]+)/);
      if (am) rows = rows.filter(p => p.author_id === am[1]);
      const im = u.match(/id=in\.\(([^)]*)\)/);
      if (im){
        const ids = im[1].split(',');
        rows = rows.filter(p => ids.includes(p.id));
      }
      if (head) return range(rows.length, '');
      return json(route, rows.slice(0, 20));
    }

    /* ---------- profiles ---------- */
    if (table === 'profiles'){
      if (method === 'PATCH'){
        const idm = u.match(/id=eq\.([^&]+)/);
        const body = JSON.parse(call.body || '{}');
        st.people.forEach(p => { if (p.id === (idm && idm[1])) Object.assign(p, body); });
        return json(route, [], 204);
      }
      let rows = st.people.slice();
      const ideq = u.match(/id=eq\.([^&]+)/);
      if (ideq) rows = rows.filter(p => p.id === ideq[1]);
      const idne = u.match(/id=neq\.([^&]+)/);
      if (idne) rows = rows.filter(p => p.id !== idne[1]);
      const idin = u.match(/id=in\.\(([^)]*)\)/);
      if (idin){ const ids = idin[1].split(','); rows = rows.filter(p => ids.includes(p.id)); }
      const orm = u.match(/or=\(([^)]*)\)/);
      if (orm){
        const t = ((orm[1].match(/ilike\.%([^,%]*)%/) || [,''])[1]).toLowerCase();
        rows = rows.filter(p => (p.username || '').toLowerCase().includes(t) ||
                                (p.display_name || '').toLowerCase().includes(t));
      }
      return json(route, rows);
    }

    /* ---------- feed_counts ---------- */
    if (table === 'feed_counts'){
      const m = u.match(/post_id=in\.\(([^)]*)\)/);
      const ids = m ? m[1].split(',').filter(Boolean) : [];
      return json(route, ids.map(id => ({
        post_id: id,
        comment_count: st.comments.filter(c => c.post_id === id).length,
        like_count: st.likes.filter(l => l.post_id === id).length
      })));
    }

    /* ---------- likes ---------- */
    if (table === 'likes'){
      if (method === 'POST'){ st.likes.push(JSON.parse(call.body)); return json(route, [], 201); }
      if (method === 'DELETE'){
        const pm = u.match(/post_id=eq\.([^&]+)/);
        st.likes = st.likes.filter(l => !(pm && l.post_id === pm[1]));
        return route.fulfill({ status: 204, body: '' });
      }
      let rows = st.likes.slice();
      const pm = u.match(/post_id=in\.\(([^)]*)\)/);
      if (pm){ const ids = pm[1].split(','); rows = rows.filter(l => ids.includes(l.post_id)); }
      const um = u.match(/user_id=eq\.([^&]+)/);
      if (um) rows = rows.filter(l => l.user_id === um[1]);
      return json(route, rows);
    }

    /* ---------- comments ---------- */
    if (table === 'comments'){
      if (method === 'POST'){
        const body = JSON.parse(call.body);
        const rec = Object.assign({
          id: 'c' + (++st.seq),
          created_at: new Date().toISOString(),
          author: { id: ME.id, username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
        }, body);
        st.comments.push(rec);
        return json(route, [rec], 201);
      }
      const pm = u.match(/post_id=eq\.([^&]+)/);
      const rows = st.comments.filter(c => !pm || c.post_id === pm[1]);
      return json(route, rows);
    }

    /* ---------- follows ---------- */
    if (table === 'follows'){
      if (method === 'POST'){ st.follows.push(JSON.parse(call.body)); return json(route, [], 201); }
      if (method === 'DELETE'){
        const f = u.match(/followee_id=eq\.([^&]+)/);
        const id = f ? f[1] : null;
        st.follows = st.follows.filter(x => x.followee_id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
      let rows = st.follows.slice();
      const fe = u.match(/followee_id=eq\.([^&]+)/);
      if (fe) rows = rows.filter(x => x.followee_id === fe[1]);
      const fi = u.match(/follower_id=eq\.([^&]+)/);
      if (fi) rows = rows.filter(x => x.follower_id === fi[1]);
      if (head) return range(rows.length, '');
      return json(route, rows.map(x => ({ followee_id: x.followee_id, follower_id: x.follower_id })));
    }

    /* ---------- conversations ---------- */
    if (table === 'conversations'){
      if (method === 'POST'){
        const body = JSON.parse(call.body);
        const rec = Object.assign({
          id: 'conv-' + (++st.seq),
          last_message_at: new Date().toISOString(),
          last_preview: null, last_sender_id: null
        }, body);
        st.convos.push(rec);
        return json(route, [rec], 201);
      }
      let rows = st.convos.slice();
      const ua = u.match(/user_a=eq\.([^&]+)/);
      if (ua) rows = rows.filter(x => x.user_a === ua[1]);
      const ub = u.match(/user_b=eq\.([^&]+)/);
      if (ub) rows = rows.filter(x => x.user_b === ub[1]);
      return json(route, rows);
    }

    /* ---------- messages ---------- */
    if (table === 'messages'){
      if (method === 'POST'){
        const body = JSON.parse(call.body);
        const rec = Object.assign({
          id: 'msg-' + (++st.seq),
          created_at: new Date().toISOString(),
          read_at: null
        }, body);
        st.msgs.push(rec);
        const cv = st.convos.find(x => x.id === rec.conversation_id);
        if (cv){ cv.last_message_at = rec.created_at; cv.last_preview = rec.body; cv.last_sender_id = rec.sender_id; }
        return json(route, [rec], 201);
      }
      let rows = st.msgs.slice();
      const cm = u.match(/conversation_id=eq\.([^&]+)/);
      if (cm) rows = rows.filter(x => x.conversation_id === cm[1]);
      const ci = u.match(/conversation_id=in\.\(([^)]*)\)/);
      if (ci){ const ids = ci[1].split(','); rows = rows.filter(x => ids.includes(x.conversation_id)); }
      const rr = /read_at=is\.null/.test(u);
      if (rr) rows = rows.filter(x => x.read_at === null);
      const ne = u.match(/sender_id=neq\.([^&]+)/);
      if (ne) rows = rows.filter(x => x.sender_id !== ne[1]);
      if (head) return range(rows.length, '');
      return json(route, rows);
    }

    return json(route, []);
  });

  return { st, calls };
}

test.describe('T4 : shell social (nav, crew, bouton flottant)', () => {

  test('navigation entre les vues + titre + fab', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);

    await openFeed(page);
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#socialTitle')).toHaveText('Home');
    await expect(page.locator('#newPostFab')).toBeVisible();

    await page.locator('#socialNav [data-view="search"]').click();
    await expect(page.locator('#view-search')).toBeVisible();
    await expect(page.locator('#view-home')).toBeHidden();
    await expect(page.locator('#socialTitle')).toHaveText('Search');
    await expect(page.locator('#newPostFab')).toBeHidden();

    await page.locator('#socialNav [data-view="profile"]').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await expect(page.locator('#socialTitle')).toHaveText('Profile');
    await expect(page.locator('#newPostFab')).toBeHidden();

    await page.locator('#socialNav [data-view="home"]').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#newPostFab')).toBeVisible();
    await page.locator('#newPostFab').click();
    /* le « + » ouvre le choix du type de publication : « Text » amene au composeur */
    await expect(page.locator('#actionSheet')).toBeVisible();
    await page.locator('#asList .as-item', { hasText: 'Text' }).click();
    await page.waitForFunction(() => document.activeElement.id === 'postBody');
    expect(errs).toEqual([]);
  });

  test('crew : la rangée de stories reflète les abonnements', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);
    api.st.follows.push({ follower_id: ME.id, followee_id: ANA });

    await openFeed(page);
    await expect(page.locator('#crewRow')).toBeVisible();
    await expect(page.locator('#crewRow .crew-cell').first()).toBeVisible();
    await expect(page.locator('#crewRow .crew-label').first()).toHaveText('You');
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(ALLOWED_KEYS);
    expect(errs).toEqual([]);
  });

  test('sign out : la vue revient à l’accueil du shell', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);

    await openFeed(page);
    await page.locator('#socialNav [data-view="inbox"]').click();
    await expect(page.locator('#view-inbox')).toBeVisible();

    await page.evaluate(() => signOutSocial());
    await expect(page.locator('#tab-feed')).toBeHidden();
    expect(await page.evaluate(() => currentSView())).toBe('home');
    expect(errs).toEqual([]);
  });
});

test.describe('T5 : likes, recherche, profil, messages', () => {

  test('like : compteur, état actif, puis unlike', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    const n = page.locator('#feedList [data-act="like"] [data-n="likes"]').first();
    await expect(n).toHaveText('0');
    await expect(page.locator('#feedList [data-act="like"]').first()).not.toHaveClass(/on/);

    await page.locator('#feedList [data-act="like"]').first().click();
    await expect(page.locator('#feedList [data-act="like"]').first()).toHaveClass(/on/);
    await expect(n).toHaveText('1');
    const ins = api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/likes'));
    expect(ins).toBeTruthy();
    expect(JSON.parse(ins.body).user_id).toBe(ME.id);
    expect(JSON.parse(ins.body).post_id).toBe('post-0');

    await page.locator('#feedList [data-act="like"]').first().click();
    await expect(page.locator('#feedList [data-act="like"]').first()).not.toHaveClass(/on/);
    await expect(n).toHaveText('0');
    const del = api.calls.find(c => c.method === 'DELETE' && c.url.includes('/rest/v1/likes'));
    expect(del).toBeTruthy();
    expect(errs).toEqual([]);
  });

  test('partage : copie le lien sans erreur console', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);

    await openFeed(page);
    await page.evaluate(() => {
      window.__shared = null;
      navigator.share = x => { window.__shared = x; return Promise.resolve(); };
    });
    await page.locator('#feedList [data-act="share"]').first().click();
    await expect.poll(() => page.evaluate(() => !!window.__shared)).toBe(true);
    expect(await page.evaluate(() => window.__shared.url)).toContain('http');
    expect(errs).toEqual([]);
  });

  test('recherche : filtre par @pseudo et bouton follow', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#socialNav [data-view="search"]').click();
    await expect(page.locator('#searchList .person')).toHaveCount(1);
    await expect(page.locator('#searchList .person-name')).toHaveText('Ana');
    await expect(page.locator('#searchList .person-meta')).toHaveText('@ana');

    await page.locator('#searchInput').fill('ana');
    await expect(page.locator('#searchList .person')).toHaveCount(1);
    await expect.poll(() => api.calls.some(c =>
      c.url.includes('/rest/v1/profiles') &&
      decodeURIComponent(c.url).includes('username.ilike.%ana%'))).toBe(true);

    await page.locator('#searchList [data-follow]').click();
    await expect(page.locator('#searchList [data-follow]')).toHaveText('Following');
    expect(api.calls.some(c => c.method === 'POST' && c.url.includes('/rest/v1/follows'))).toBe(true);
    expect(errs).toEqual([]);
  });

  test('profil : stats, onglets, grille puis édition du @pseudo', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#socialNav [data-view="profile"]').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await expect(page.locator('#profHandle')).toHaveText('@mouataz');
    await expect(page.locator('#profName')).toHaveText('Mouataz');
    await expect(page.locator('#statPosts')).toHaveText('2');
    /* G : Posts + Reposts + Liked + Saved */
    await expect(page.locator('#profTabs .ptab')).toHaveCount(4);
    await expect(page.locator('#profGrid .ptile')).toHaveCount(2);

    await page.locator('.ptab[data-ptab="reposts"]').click();
    await expect(page.locator('#profGridReposts')).toBeVisible();
    await expect(page.locator('#profGridReposts')).toContainText('No reposts yet');
    await page.locator('.ptab[data-ptab="grid"]').click();

    await page.locator('.ptab[data-ptab="liked"]').click();
    await expect(page.locator('#profGridLiked')).toBeVisible();
    await expect(page.locator('#profGridLiked')).toContainText('No liked posts yet');
    await page.locator('.ptab[data-ptab="grid"]').click();
    await expect(page.locator('#profGrid')).toBeVisible();

    await page.locator('#editProfileBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.locator('#editUsername').fill('mouataz_lifts');
    await page.locator('#editName').fill('Mouataz');
    await page.locator('#editBio').fill('Chasing a 2x bodyweight squat');
    await page.locator('#profileSubmit').click();
    await expect(page.locator('#profileModal')).toBeHidden();
    await expect(page.locator('#profHandle')).toHaveText('@mouataz_lifts');

    const patch = api.calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/profiles'));
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch.body).username).toBe('mouataz_lifts');
    expect(errs).toEqual([]);
  });

  test('messages : boîte vide, fil, envoi et badge', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#socialNav [data-view="inbox"]').click();
    await expect(page.locator('#view-inbox')).toBeVisible();
    await expect(page.locator('#inboxList')).toContainText('No messages yet');

    await page.evaluate(id => window.openThread(id), ANA);
    await expect(page.locator('#view-thread')).toBeVisible();
    await expect(page.locator('#threadName')).toHaveText('Ana');
    await expect(page.locator('#threadMeta')).toHaveText('@ana');
    expect(api.calls.some(c => c.method === 'POST' && c.url.includes('/rest/v1/conversations'))).toBe(true);

    await page.locator('#threadBody').fill('Nice session!');
    await page.locator('#threadSend').click();
    await expect(page.locator('#threadList .bub')).toHaveCount(1);
    await expect(page.locator('#threadList .bub').first()).toHaveText('Nice session!');
    expect(api.calls.some(c => c.method === 'POST' && c.url.includes('/rest/v1/messages'))).toBe(true);

    await page.locator('#threadBack').click();
    await expect(page.locator('#view-inbox')).toBeVisible();
    await expect(page.locator('#inboxList .dm')).toHaveCount(1);
    await expect(page.locator('#inboxList .dm-last')).toHaveText('Nice session!');
    expect(errs).toEqual([]);
  });
});
