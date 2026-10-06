const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const MOCK_CONFIG = { supabaseUrl: 'https://demo-project.supabase.co', anonKey: 'anon-key-for-tests' };
const ALLOWED_KEYS = ['at_lastUser', 'at_profiles', 'at_tab', 'at_v2_Mouataz', 'at_v2_Mouataz_t'];

const ME = { id: '11111111-1111-4111-8111-111111111111', user_metadata: { name: 'Mouataz' } };
const ANA = '22222222-2222-4222-8222-222222222222';

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
    body: 'Séance ' + i,
    image_path: null,
    thumb_path: null,
    meta: {},
    created_at: new Date(Date.now() - i * 3600000).toISOString(),
    deleted_at: null,
    author_id: authorId || ME.id,
    author: authorId === ANA
      ? { username: 'ana', display_name: 'Ana', avatar_url: null }
      : { username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
  }, over || {});
}

/* Fake backend Supabase (rest uniquement) : posts / profiles / follows /
   comments / feed_counts. Retourne les requêtes observées. */
function mockApi(page, opts){
  const st = Object.assign({
    posts: [post(0), post(1)],
    people: [ { id: ANA, username: 'ana', display_name: 'Ana', avatar_url: null,
      bio: 'Push day', created_at: new Date().toISOString() } ],
    comments: [],
    follows: [],
    seq: 0
  }, opts || {});

  const calls = [];
  const json = (route, body, status) => route.fulfill({
    status: status || 200, contentType: 'application/json', body: JSON.stringify(body)
  });

  page.route('**/*.supabase.co/**', async route => {
    const req = route.request();
    const call = { url: req.url(), method: req.method(), body: req.postData(), resource: req.url() };
    calls.push(call);

    if (!call.url.includes('/rest/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });

    const u = decodeURIComponent(call.url);
    const tm = u.match(/\/rest\/v1\/([a-z_]+)(\?|$)/);
    const table = tm ? tm[1] : null;
    const method = call.method.toUpperCase();

    if (table === 'posts'){
      const m = u.match(/author_id=in\.\(([^)]*)\)/);
      let rows = st.posts;
      if (m){
        const ids = m[1].split(',').filter(Boolean);
        rows = st.posts.filter(p => ids.includes(p.author_id));
      }
      return json(route, rows.slice(0, 20));
    }

    if (table === 'feed_counts'){
      const m = u.match(/post_id=in\.\(([^)]*)\)/);
      const ids = m ? m[1].split(',').filter(Boolean) : [];
      return json(route, ids.map(id => ({
        post_id: id,
        comment_count: st.comments.filter(c => c.post_id === id).length
      })));
    }

    if (table === 'comments'){
      if (method === 'POST'){
        const body = JSON.parse(call.body);
        const rec = Object.assign({
          id: 'c' + (++st.seq),
          created_at: new Date().toISOString(),
          author: { username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
        }, body);
        st.comments.push(rec);
        return json(route, [rec], 201);
      }
      const pm = u.match(/post_id=eq\.([^&]+)/);
      const rows = st.comments.filter(c => !pm || c.post_id === pm[1]);
      return json(route, rows);
    }

    if (table === 'profiles'){
      return json(route, st.people);
    }

    if (table === 'follows'){
      if (method === 'POST'){
        st.follows.push(JSON.parse(call.body));
        return json(route, [], 201);
      }
      if (method === 'DELETE'){
        const f = u.match(/followee_id=eq\.([^&]+)/);
        const id = f ? f[1] : null;
        st.follows = st.follows.filter(x => x.followee_id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
      return json(route, st.follows.map(x => ({ followee_id: x.followee_id })));
    }

    return json(route, []);
  });

  return { st, calls };
}

function keysOf(page){
  return page.evaluate(() => Object.keys(localStorage).sort());
}

test.describe('T3 : commentaires, follows, filtre du fil', () => {

  test('commentaire : ouverture, envoi, compteur, fermeture par Échap', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(2);
    await expect(page.locator('#feedList .post-act-n').first()).toHaveText('0');

    await page.locator('#feedList .post-act').first().click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    await expect(page.locator('#commentList .comment-empty')).toHaveText('No comments yet — be the first.');
    await expect(page.locator('#commentSubmit')).toBeDisabled();

    await page.fill('#commentBody', 'Nice set, keep the tempo.');
    await expect(page.locator('#commentSubmit')).toBeEnabled();
    await page.locator('#commentSubmit').click();

    await expect(page.locator('#commentList .comment')).toHaveCount(1);
    await expect(page.locator('#commentList .comment-body')).toHaveText('Nice set, keep the tempo.');
    await expect(page.locator('#commentsSub')).toHaveText('1 comment');
    await expect(page.locator('#commentBody')).toHaveValue('');
    await expect(page.locator('#feedList .post-act-n').first()).toHaveText('1');

    const insert = api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/comments'));
    expect(insert).toBeTruthy();
    const payload = JSON.parse(insert.body);
    expect(payload.post_id).toBe('post-0');
    expect(payload.body).toBe('Nice set, keep the tempo.');

    await page.keyboard.press('Escape');
    await expect(page.locator('#commentsModal')).toBeHidden();

    expect(await keysOf(page)).toEqual([...ALLOWED_KEYS].sort());
    expect(errs).toEqual([]);
  });

  test('commentaires : le compteur survit au rechargement (feed_counts)', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);
    api.st.comments.push({
      id: 'c-old', post_id: 'post-1', author_id: ANA, body: 'Solid PR!',
      created_at: new Date().toISOString(),
      author: { username: 'ana', display_name: 'Ana', avatar_url: null }
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post-act-n').nth(1)).toHaveText('1');
    await expect(page.locator('#feedList .post-act-l').nth(1)).toHaveText('Comment');
    expect(api.calls.some(c => c.url.includes('/rest/v1/feed_counts'))).toBe(true);

    await page.locator('#feedList .post-act').nth(1).click();
    await expect(page.locator('#commentList .comment')).toHaveCount(1);
    await expect(page.locator('#commentList .comment-name').first()).toHaveText('Ana');
    expect(errs).toEqual([]);
  });

  test('people : annuaire, follow optimiste puis requête, unfollow', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#peopleBtn').click();
    await expect(page.locator('#peopleModal')).toBeVisible();
    await expect(page.locator('#peopleList .person')).toHaveCount(1);
    await expect(page.locator('#peopleList .person-name')).toHaveText('Ana');
    await expect(page.locator('#peopleList [data-follow]')).toHaveText('Follow');

    await page.locator('#peopleList [data-follow]').click();
    await expect(page.locator('#peopleList [data-follow]')).toHaveText('Following');
    const ins = api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/follows'));
    expect(ins).toBeTruthy();
    expect(JSON.parse(ins.body).followee_id).toBe(ANA);

    await page.locator('#peopleList [data-follow]').click();
    await expect(page.locator('#peopleList [data-follow]')).toHaveText('Follow');
    const del = api.calls.find(c => c.method === 'DELETE' && c.url.includes('/rest/v1/follows'));
    expect(del).toBeTruthy();
    expect(decodeURIComponent(del.url)).toContain('followee_id=eq.' + ANA);

    await page.keyboard.press('Escape');
    await expect(page.locator('#peopleModal')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test('filtre Following : sans abonnement → invitation à trouver du monde', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);

    await openFeed(page);
    await page.locator('#feedFilter .seg[data-scope="following"]').click();

    await expect(page.locator('#feedList .feed-empty-t')).toHaveText('No one in your crew yet');
    await expect(page.locator('#feedList .feed-empty-s'))
      .toContainText('Follow a few lifters and their sessions will show up here.');
    await expect(page.locator('#feedList .post')).toHaveCount(0);
    await expect(page.locator('#feedFilter .seg[data-scope="following"]')).toHaveClass(/active/);

    await page.locator('#feedList .feed-empty button').click();
    await expect(page.locator('#peopleModal')).toBeVisible();

    expect(errs).toEqual([]);
  });

  test('filtre Following : n’affiche que les abonnements', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);

    const api = mockApi(page);
    api.st.posts = [post(0), post(1, ANA)];
    api.st.follows = [{ follower_id: ME.id, followee_id: ANA }];

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(2);

    await page.locator('#feedFilter .seg[data-scope="following"]').click();
    await expect(page.locator('#feedList .post')).toHaveCount(1);
    await expect(page.locator('#feedList .post-name').first()).toHaveText('Ana');

    const scoped = api.calls.find(c => c.url.includes('/rest/v1/posts') && c.url.includes('author_id=in.'));
    expect(scoped).toBeTruthy();
    expect(decodeURIComponent(scoped.url)).toContain('author_id=in.(' + ANA + ')');

    await page.locator('#feedFilter .seg[data-scope="all"]').click();
    await expect(page.locator('#feedList .post')).toHaveCount(2);

    expect(await keysOf(page)).toEqual([...ALLOWED_KEYS].sort());
    expect(errs).toEqual([]);
  });

  test('gate : l’onglet Feed suit la connexion réseau', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);

    await expect(page.locator('#tabFeedBtn')).toBeVisible();
    expect(await page.evaluate(() => window.socialAvailable())).toBe(true);

    await page.context().setOffline(true);
    await page.evaluate(() => window.updateSocialGate());
    await expect(page.locator('#tabFeedBtn')).toBeHidden();
    expect(await page.evaluate(() => window.socialAvailable())).toBe(false);

    await page.context().setOffline(false);
    await page.evaluate(() => window.updateSocialGate());
    await expect(page.locator('#tabFeedBtn')).toBeVisible();
    expect(await page.evaluate(() => window.socialAvailable())).toBe(true);

    expect(errs).toEqual([]);
  });
});
