const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

/* Un projet Supabase réel n'est pas encore créé : on injecte la config
   avant le chargement des modules, ce qui reproduit exactement ce que
   ferait un déploiement avec les vraies clés. */
const MOCK_CONFIG = { supabaseUrl: 'https://demo-project.supabase.co', anonKey: 'anon-key-for-tests' };
const ALLOWED_KEYS = ['at_lastUser', 'at_profiles', 'at_tab', 'at_v2_Mouataz', 'at_v2_Mouataz_t'];

function withSocial(page){
  return page.addInitScript(cfg => { window.LIFTR_SOCIAL_CONFIG = cfg; }, MOCK_CONFIG);
}

/* Simule un utilisateur connecté, après toute tentative de restauration. */
function signedIn(page, user){
  return page.evaluate(u => {
    return Promise.resolve(window.restoreSession()).then(() => {
      window.socialUser = u;
      window.updateSocialGate();
    });
  }, user || { id: 'u-1', user_metadata: { name: 'Mouataz' } });
}

test.describe('Social : socle dormant', () => {

  test('sans configuration : rien ne s’active, aucune requête, aucune clé en plus', async ({ page }) => {
    const errs = [];
    const external = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:8099')) external.push(r.url()); });

    await seed(page, {});

    const st = await page.evaluate(() => ({
      enabled: window.SOCIAL_ENABLED,
      createClient: typeof window.supabase.createClient,
      socialUser: window.socialUser,
      keys: Object.keys(localStorage).sort()
    }));

    expect(st.enabled).toBe(false);
    expect(st.createClient).toBe('function');
    expect(st.socialUser).toBeNull();

    expect(st.keys.every(k => ALLOWED_KEYS.includes(k))).toBe(true);
    expect(st.keys.some(k => /auth|supabase|sb-/i.test(k))).toBe(false);

    await expect(page.locator('#tabFeedBtn')).toBeHidden();
    await expect(page.locator('#socialCta')).toBeHidden();
    await expect(page.locator('#tab-feed')).toBeHidden();

    expect(external).toEqual([]);
    expect(errs).toEqual([]);
  });

  test('buildAuthUrl construit l’autorisation Supabase Google', async ({ page }) => {
    await seed(page, {});

    expect(await page.evaluate(() => buildAuthUrl({
      supabaseUrl: 'https://abc.supabase.co/',
      redirectTo: 'https://x.test/app.html'
    }))).toBe('https://abc.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fx.test%2Fapp.html');

    expect(await page.evaluate(() => buildAuthUrl()).catch(() => 'err')).toBeNull();

    const auto = await page.evaluate(() => buildAuthUrl({ supabaseUrl: 'https://abc.supabase.co' }));
    expect(auto).toContain('https://abc.supabase.co/auth/v1/authorize?provider=google');
    const origin = await page.evaluate(() => location.origin + '/index.html');
    expect(auto).toContain('redirect_to=' + encodeURIComponent(origin));
  });

  test('signInGoogle sans configuration : message, aucune navigation', async ({ page }) => {
    await seed(page, {});
    const url = page.url();

    await page.evaluate(() => signInGoogle());
    await page.waitForFunction(() => {
      const t = document.getElementById('toast');
      return t && /configured/i.test(t.textContent);
    });

    expect(page.url()).toBe(url);
  });

  test('showTab("feed") alors que le social est fermé retombe sur Programme', async ({ page }) => {
    await seed(page, {});
    await page.evaluate(() => showTab('feed'));

    expect(await page.evaluate(() => currentTab)).toBe('programme');
    await expect(page.locator('#tab-programme')).toBeVisible();
    await expect(page.locator('#tab-feed')).toBeHidden();
  });
});

test.describe('Social : portes d’entrée (config injectée)', () => {

  test('connecté et en ligne : l’onglet Feed apparaît et s’ouvre', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});

    expect(await page.evaluate(() => SOCIAL_ENABLED)).toBe(true);
    await signedIn(page);

    await expect(page.locator('#tabFeedBtn')).toBeVisible();
    await expect(page.locator('#socialCta')).toBeHidden();

    await page.locator('#tabFeedBtn').click();
    await expect(page.locator('#tab-feed')).toBeVisible();
    await expect(page.locator('#feedHint')).toBeVisible();
    await expect(page.locator('#tab-feed button:has-text("Sign out")')).toBeVisible();
    expect(await page.evaluate(() => currentTab)).toBe('feed');
  });

  test('hors ligne : Feed se ferme même si l’utilisateur est connecté', async ({ page, context }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await expect(page.locator('#tabFeedBtn')).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
      updateSocialGate();
    });

    await expect(page.locator('#tabFeedBtn')).toBeHidden();
    expect(await page.evaluate(() => socialAvailable())).toBe(false);
    expect(await page.evaluate(() => currentTab)).toBe('programme');
  });

  test('déconnexion : l’onglet Feed disparaît', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await page.locator('#tabFeedBtn').click();
    await expect(page.locator('#tab-feed')).toBeVisible();

    await page.locator('#tab-feed button:has-text("Sign out")').click();

    await page.waitForFunction(() => window.socialUser === null);
    await expect(page.locator('#tabFeedBtn')).toBeHidden();
    await expect(page.locator('#tab-feed')).toBeHidden();
    expect(await page.evaluate(() => currentTab)).toBe('programme');
  });

  test('signInGoogle ouvre bien l’autorisation Supabase avec provider=google', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>oauth</title>' }));
    await withSocial(page);
    await seed(page, {});

    await page.evaluate(() => signInGoogle());
    await page.waitForURL('**/auth/v1/authorize**', { timeout: 7000 });

    expect(page.url()).toContain('demo-project.supabase.co/auth/v1/authorize');
    expect(page.url()).toContain('provider=google');
    expect(page.url()).toContain('redirect_to=');
  });
});
