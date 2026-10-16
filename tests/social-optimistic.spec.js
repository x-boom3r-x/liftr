const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const MOCK_CONFIG = { supabaseUrl: 'https://demo-project.supabase.co', anonKey: 'anon-key-for-tests' };
const ME = { id: '11111111-1111-4111-8111-111111111111', user_metadata: { name: 'Mouataz' } };

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

function post(i){
  return {
    id: 'post-' + i, kind: 'text', body: 'Séance ' + i,
    image_path: null, thumb_path: null, meta: {},
    created_at: new Date(Date.now() - i * 3600000).toISOString(),
    deleted_at: null, author_id: ME.id,
    author: { username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
  };
}

/* Fake Supabase : POST comments lent (commentDelayMs) ou en échec (failComment). */
function mockApi(page, opts){
  opts = opts || {};
  const st = { posts: [post(0)], comments: [], seq: 0 };
  const calls = [];
  const json = (route, body, status) => route.fulfill({
    status: status || 200, contentType: 'application/json', body: JSON.stringify(body)
  });

  page.route('**/*.supabase.co/**', async route => {
    const req = route.request();
    const call = { url: req.url(), method: req.method(), body: req.postData() };
    calls.push(call);
    if (!call.url.includes('/rest/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });

    const u = decodeURIComponent(call.url);
    const tm = u.match(/\/rest\/v1\/([a-z_]+)(\?|$)/);
    const table = tm ? tm[1] : null;
    const method = call.method.toUpperCase();

    if (table === 'posts') return json(route, st.posts.slice(0, 20));

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
        if (opts.commentDelayMs) await new Promise(r => setTimeout(r, opts.commentDelayMs));
        if (opts.failComment)
          return json(route, { message: 'Could not post your comment.', code: '40000' }, 400);
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
      return json(route, st.comments.filter(c => !pm || c.post_id === pm[1]));
    }

    if (table === 'profiles') return json(route, []);
    return json(route, []);
  });
  return { st, calls };
}

async function openCommentsAndType(page, text){
  await openFeed(page);
  await page.locator('#feedList [data-act="reply"]').first().click();
  await expect(page.locator('#commentsModal')).toBeVisible();
  await page.fill('#commentBody', text);
  await expect(page.locator('#commentSubmit')).toBeEnabled();
  await page.locator('#commentSubmit').click();
}

test.describe('Comments : updates optimistes', () => {

  test('apparition immédiate : la ligne s’affiche avant la réponse serveur', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, { commentDelayMs: 900 });

    await openCommentsAndType(page, 'Nice set, keep the tempo.');

    /* optimiste : la ligne EST là, encore marquée « en attente » */
    await expect(page.locator('#commentList .comment-pending')).toHaveCount(1);
    await expect(page.locator('#commentList .comment-body')).toHaveText('Nice set, keep the tempo.');
    /* le brouillon est vidé tout de suite (le serveur n'a pas encore répondu) */
    await expect(page.locator('#commentBody')).toHaveValue('');

    /* le serveur répond : la ligne est confirmée (vrai id, plus « pending ») */
    await expect(page.locator('#commentList .comment-pending')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('#commentList .comment')).toHaveCount(1);
    const replyId = await page.locator('#commentList [data-reply]').first().getAttribute('data-reply');
    expect(replyId).toMatch(/^c\d+$/);
    await expect(page.locator('#commentsSub')).toHaveText('1 comment');
    expect(errs).toEqual([]);
  });

  test('rollback : échec serveur → ligne retirée, brouillon restauré, toast', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    /* délai aussi sur l'échec : il faut le temps d'observer l'état optimiste */
    mockApi(page, { failComment: true, commentDelayMs: 700 });

    await openCommentsAndType(page, 'This one will fail.');

    /* optimiste d'abord… */
    await expect(page.locator('#commentList .comment-pending')).toHaveCount(1);
    /* …puis rollback au bout de l'erreur */
    await expect(page.locator('#commentList .comment')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('#commentList .comment-empty'))
      .toHaveText('No comments yet — be the first.');
    /* le brouillon est rendu à l'utilisateur */
    await expect(page.locator('#commentBody')).toHaveValue('This one will fail.');
    await expect(page.locator('#toast')).toContainText('Could not post your comment.');
    /* le 400 est volontaire : on ignore seulement l'erreur réseau du navigateur */
    expect(errs.filter(e => !/Failed to load resource/i.test(e))).toEqual([]);
  });

  test('réponse optimiste : indentée, sans bouton Reply tant que non confirmée', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, { commentDelayMs: 700 });

    await openFeed(page);
    await page.locator('#feedList [data-act="reply"]').first().click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    /* premier commentaire (racine) */
    await page.fill('#commentBody', 'Root comment.');
    await page.locator('#commentSubmit').click();
    await expect(page.locator('#commentList .comment')).toHaveCount(1, { timeout: 5000 });

    /* répondre à la racine confirmée */
    await page.locator('#commentList [data-reply]').first().click();
    await page.fill('#commentBody', 'A reply.');
    await page.locator('#commentSubmit').click();

    /* la réponse optimiste apparaît mais n'offre pas de Reply (id temporaire) */
    await expect(page.locator('#commentList .comment-pending')).toHaveCount(1);
    await expect(page.locator('#commentList .comment-pending .comment-reply')).toHaveCount(0);
    /* puis confirmée : le Reply revient */
    await expect(page.locator('#commentList .comment-pending')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('#commentList .comment-reply')).toHaveCount(2);
  });
});
