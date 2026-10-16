const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const MOCK_CONFIG = { supabaseUrl: 'https://demo-project.supabase.co', anonKey: 'anon-key-for-tests' };
const USER = { id: '11111111-1111-4111-8111-111111111111', user_metadata: { name: 'Mouataz' } };

function withSocial(page){
  return page.addInitScript(cfg => { window.LIFTR_SOCIAL_CONFIG = cfg; }, MOCK_CONFIG);
}

async function signedIn(page){
  await page.evaluate(u => Promise.resolve(window.restoreSession()).then(() => {
    window.socialUser = u;
    window.updateSocialGate();
  }), USER);
}

function notif(i, over){
  return Object.assign({
    id: 'notif-' + i,
    type: 'like',
    post_id: 'post-' + i,
    comment_id: null,
    read_at: null,
    created_at: new Date(Date.now() - i * 3600000).toISOString(),
    actor: {
      id: '22222222-2222-4222-8222-222222222222',
      username: 'ana', display_name: 'Ana', avatar_url: null
    },
    post: { id: 'post-' + i, body: 'Séance ' + i + ' — good volume.' }
  }, over || {});
}

/* Route unique Supabase : le centre de notifications n'utilise que /rest/v1/notifications
   (GET liste, HEAD count exact, PATCH marquage lu). */
function notifRoute(page, rows, unreadCount){
  const calls = [];
  page.route('**/*.supabase.co/**', async route => {
    const req = route.request();
    const call = { url: req.url(), method: req.method(), body: req.postData() };
    calls.push(call);
    if (!call.url.includes('/rest/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (!call.url.includes('/rest/v1/notifications')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (req.method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { 'content-range': '0-0/' + (unreadCount || 0) } });
    }
    if (req.method() === 'PATCH') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  return calls;
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

test.describe('Centre de notifications', () => {

  test('liste + marqueur non-lu + badge', async ({ page }) => {
    const rows = [notif(0), notif(1), notif(2, { type: 'follow', post_id: null, read_at: '2026-01-01T00:00:00Z' })];
    notifRoute(page, rows, 2);
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    await page.locator('#notifBtn').click();
    await expect(page.locator('#notifModal')).toBeVisible();

    const items = page.locator('#notifList .notif');
    await expect(items).toHaveCount(3);
    /* 2 non-lues (like) + 1 lue (follow) */
    await expect(page.locator('#notifList .notif-unread')).toHaveCount(2);
    /* le libellé de la notif « like » nomme bien l'acteur */
    await expect(page.locator('#notifList .notif-text').first()).toContainText('Ana');
    /* badge : 2 non-lues */
    await expect(page.locator('#notifDot')).toBeVisible();
    await expect(page.locator('#notifDot')).toHaveText('2');
    expect(errs.filter(e => /uncaught|unhandled/i.test(e))).toEqual([]);
  });

  test('état vide : aucune notif, badge masqué', async ({ page }) => {
    notifRoute(page, [], 0);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    await expect(page.locator('#notifDot')).toBeHidden();
    await page.locator('#notifBtn').click();
    await expect(page.locator('#notifModal')).toBeVisible();
    await expect(page.locator('#notifList')).toContainText('No notifications yet.');
    await expect(page.locator('#notifList .notif')).toHaveCount(0);
  });

  test('clic sur une notif non-lue : requête PATCH read_at, badge décrémenté', async ({ page }) => {
    const rows = [notif(0), notif(1)];
    const calls = notifRoute(page, rows, 2);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    await page.locator('#notifBtn').click();
    await expect(page.locator('#notifDot')).toHaveText('2');

    /* la première notif est non-lue : clic → marquée lue */
    await page.locator('#notifList .notif').first().click();
    await expect(page.locator('#notifList .notif').first()).not.toHaveClass(/notif-unread/);
    await expect(page.locator('#notifDot')).toHaveText('1');

    const patch = calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/notifications'));
    expect(patch).toBeTruthy();
    expect(patch.url).toContain('id=eq.notif-0');
    expect(patch.body).toContain('read_at');
  });

  test('Mark all read : toutes lues, badge masqué', async ({ page }) => {
    const rows = [notif(0), notif(1)];
    const calls = notifRoute(page, rows, 2);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    await page.locator('#notifBtn').click();
    await page.locator('#notifModal button', { hasText: 'Mark all read' }).click();

    await expect(page.locator('#notifList .notif-unread')).toHaveCount(0);
    await expect(page.locator('#notifDot')).toBeHidden();

    const patch = calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/notifications'));
    expect(patch).toBeTruthy();
    expect(patch.url).toContain('read_at=is.null');
    expect(patch.body).toContain('read_at');
  });

  test('hors session : aucune requête, pas de panneau', async ({ page }) => {
    const calls = notifRoute(page, [], 0);
    await seed(page, {});
    /* pas de config injectée → social dormant */
    const ok = await page.evaluate(() => window.openNotifications());
    expect(ok).toBe(false);
    await expect(page.locator('#notifModal')).toBeHidden();
    expect(calls.filter(c => c.url.includes('/rest/v1/notifications'))).toEqual([]);
  });
});
