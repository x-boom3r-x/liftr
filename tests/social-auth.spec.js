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

  test('au boot : aucune requête réseau, aucune clé en plus, rien n’est connecté', async ({ page }) => {
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

    expect(st.enabled).toBe(true);
    expect(st.createClient).toBe('function');
    expect(st.socialUser).toBeNull();

    expect(st.keys.every(k => ALLOWED_KEYS.includes(k))).toBe(true);
    expect(st.keys.some(k => /auth|supabase|sb-/i.test(k))).toBe(false);

    /* Chantier F : le bouton Feed reste toujours visible (1er des 3 racines) ;
       c'est le panneau qui se ferme quand on n'est pas connecté. */
    await expect(page.locator('#tabFeedBtn')).toBeVisible();
    await expect(page.locator('#tab-feed')).toBeHidden();
    await expect(page.locator('#signInBtn')).toBeVisible();
    // l'invite de connexion est dégagée (le conteneur peut être masqué selon l'écran)
    expect(await page.evaluate(() =>
      document.getElementById('socialCta').classList.contains('hidden'))).toBe(false);

    expect(external).toEqual([]);
    expect(errs).toEqual([]);
  });

  test('buildAuthUrl construit l’autorisation Supabase Google', async ({ page }) => {
    await seed(page, {});

    expect(await page.evaluate(() => buildAuthUrl({
      supabaseUrl: 'https://abc.supabase.co/',
      redirectTo: 'https://x.test/app.html'
    }))).toBe('https://abc.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fx.test%2Fapp.html');

    const real = await page.evaluate(() => buildAuthUrl());
    const base = await page.evaluate(() => SOCIAL_CONFIG.supabaseUrl.replace(/\/+$/, ''));
    expect(real).toContain(base + '/auth/v1/authorize?provider=google');
    expect(real).toContain('redirect_to=');
  });

  test('signInGoogle quand le social est coupé : message, aucune navigation', async ({ page }) => {
    await page.addInitScript(() => { window.LIFTR_SOCIAL_CONFIG = { supabaseUrl: '', anonKey: '' }; });
    await seed(page, {});
    const url = page.url();

    expect(await page.evaluate(() => SOCIAL_ENABLED)).toBe(false);
    expect(await page.evaluate(() => buildAuthUrl())).toBeNull();

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
    await expect(page.locator('#signInBtn')).toBeHidden();

    await page.locator('#tabFeedBtn').click();
    await expect(page.locator('#tab-feed')).toBeVisible();
    await expect(page.locator('#socialHint')).toBeVisible();
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

    /* Chantier F : hors-ligne le bouton Feed reste visible mais la racine
       bascule sur Gym (l'app reste 100 % utilisable). */
    await expect(page.locator('#tabFeedBtn')).toBeVisible();
    expect(await page.evaluate(() => socialAvailable())).toBe(false);
    expect(await page.evaluate(() => currentTab)).toBe('programme');
  });

  test('déconnexion : le panneau Feed se ferme, le bouton reste', async ({ page }) => {
    await page.route('**/*.supabase.co/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await page.locator('#tabFeedBtn').click();
    await expect(page.locator('#tab-feed')).toBeVisible();

    await page.locator('#tab-feed button:has-text("Sign out")').click();

    await page.waitForFunction(() => window.socialUser === null);
    await expect(page.locator('#tabFeedBtn')).toBeVisible();
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

  test('retour OAuth : le fragment #access_token ouvre la session (sans reconnexion manuelle)', async ({ page }) => {
    const user = {
      id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', role: 'authenticated',
      email: 'mou@liftr.test', email_confirmed_at: '2026-01-01T00:00:00.000Z', phone: '',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      app_metadata: { provider: 'google', providers: ['email', 'google'] },
      user_metadata: { name: 'Mouataz' }, identities: [], is_anonymous: false
    };
    const seen = [];
    await page.route('**/*.supabase.co/auth/v1/**', async route => {
      const url = route.request().url();
      seen.push(url);
      if (url.includes('/auth/v1/user')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await withSocial(page);
    await seed(page, {});

    const frag = '#access_token=google-access-token&token_type=bearer&expires_in=3600' +
      '&expires_at=' + (Math.floor(Date.now() / 1000) + 3600) + '&refresh_token=google-refresh-token';
    await page.goto('/index.html' + frag);
    await page.reload();
    await page.waitForFunction(() => !!window.socialUser, { timeout: 7000 });

    expect(await page.evaluate(() => window.socialUser.email)).toBe('mou@liftr.test');
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(await page.evaluate(() => Object.keys(localStorage).some(k => k.indexOf('liftr-auth') >= 0))).toBe(true);
    expect(seen.some(u => u.indexOf('/auth/v1/user') >= 0)).toBe(true);

    await expect(page.locator('#tabFeedBtn')).toBeVisible();
    await expect(page.locator('#signInBtn')).toBeHidden();
    /* F : session restaurée + en ligne → premier lancement sur Feed */
    expect(await page.evaluate(() => currentTab)).toBe('feed');
  });
});

test.describe('Social : email / mot de passe', () => {

  const SESSION = {
    access_token: 'fake-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'fake-refresh-token',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'mou@liftr.test',
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      phone: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name: 'Mouataz' },
      identities: [],
      is_anonymous: false
    }
  };

  /* Intercepte les endpoints GoTrue et renvoie la liste des URLs appelées.
     L'utilisateur renvoyé reprend l'email du corps de la requête. */
  function authRoutes(page, respond){
    const seen = [];
    page.route('**/*.supabase.co/auth/v1/**', async route => {
      const url = route.request().url();
      seen.push(url);
      if (respond) return respond(route, url);
      let email = SESSION.user.email;
      try {
        const body = route.request().postDataJSON();
        if (body && body.email) email = body.email;
      } catch(e){}
      const payload = Object.assign({}, SESSION, {
        user: Object.assign({}, SESSION.user, { email })
      });
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(payload)
      });
    });
    return seen;
  }

  test('le bouton Sign in ouvre le panneau email, sans requête réseau', async ({ page }) => {
    const external = [];
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:8099')) external.push(r.url()); });

    await withSocial(page);
    await seed(page, {});
    await page.click('#signInBtn');

    await expect(page.locator('#authModal')).toHaveClass(/show/);
    await expect(page.locator('#authTitle')).toHaveText('Sign in');
    await expect(page.locator('#authSubmit')).toHaveText('Sign in');
    await expect(page.locator('#authToggle')).toHaveText('Create an account');
    await expect(page.locator('#authError')).toBeHidden();
    await expect(page.locator('#authGoogleBtn')).toBeVisible();
    expect(await page.evaluate(() => window.socialUser)).toBeNull();

    await page.keyboard.press('Escape');
    expect(external).toEqual([]);
  });

  test('googleAuth: false masque le bouton Google même si le social est ouvert', async ({ page }) => {
    await page.addInitScript(cfg => { window.LIFTR_SOCIAL_CONFIG = cfg; }, {
      supabaseUrl: 'https://demo-project.supabase.co',
      anonKey: 'anon-key-for-tests',
      googleAuth: false
    });
    await seed(page, {});

    expect(await page.evaluate(() => GOOGLE_ENABLED)).toBe(false);

    await page.click('#signInBtn');
    await expect(page.locator('#authModal')).toHaveClass(/show/);
    await expect(page.locator('#authGoogleBtn')).toBeHidden();
  });

  test('openAuth quand le social est coupé : toast, pas de panneau', async ({ page }) => {
    await page.addInitScript(() => { window.LIFTR_SOCIAL_CONFIG = { supabaseUrl: '', anonKey: '' }; });
    await seed(page, {});

    expect(await page.evaluate(() => openAuth())).toBe(false);
    expect(await page.evaluate(() => document.getElementById('authModal').classList.contains('show'))).toBe(false);
    expect(await page.evaluate(() => buildEmailEndpoint())).toBeNull();

    await page.waitForFunction(() => /configured/i.test(document.getElementById('toast').textContent));
  });

  test('buildEmailEndpoint construit les endpoints Supabase', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});

    expect(await page.evaluate(() => buildEmailEndpoint({ supabaseUrl: 'https://abc.supabase.co/' })))
      .toBe('https://abc.supabase.co/auth/v1/token?grant_type=password');
    expect(await page.evaluate(() => buildEmailEndpoint({ supabaseUrl: 'https://abc.supabase.co/', kind: 'signup' })))
      .toBe('https://abc.supabase.co/auth/v1/signup');
  });

  test('soumission incomplète : message en ligne, aucune requête', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    const seen = authRoutes(page);

    await page.click('#signInBtn');
    expect(await page.evaluate(() => submitAuth())).toBe(false);

    await expect(page.locator('#authError')).toHaveText('Email and password are required.');
    await expect(page.locator('#authModal')).toHaveClass(/show/);
    expect(seen).toEqual([]);
  });

  test('connexion email réussie : session ouverte et onglet Feed visible', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    const seen = authRoutes(page);

    await page.click('#signInBtn');
    await page.fill('#authEmail', 'mou@liftr.test');
    await page.fill('#authPass', 'secret123');

    expect(await page.evaluate(() => submitAuth())).toBe(true);

    expect(seen.length).toBe(1);
    expect(seen[0]).toContain('/auth/v1/token?grant_type=password');
    expect(seen[0]).toContain('demo-project.supabase.co');

    await expect(page.locator('#authModal')).not.toHaveClass(/show/);
    await expect(page.locator('#authError')).toBeHidden();
    expect(await page.evaluate(() => window.socialUser && window.socialUser.email)).toBe('mou@liftr.test');
    await expect(page.locator('#tabFeedBtn')).toBeVisible();
    await expect(page.locator('#signInBtn')).toBeHidden();
    await expect(page.locator('#socialCta')).toBeHidden();

    await page.locator('#tabFeedBtn').click();
    await expect(page.locator('#tab-feed')).toBeVisible();
    expect(await page.evaluate(() => currentTab)).toBe('feed');
  });

  test('mauvais mot de passe : message en ligne, toujours déconnecté', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    authRoutes(page, route => route.fulfill({
      status: 400, contentType: 'application/json',
      body: JSON.stringify({
        code: 400, error_code: 'invalid_credentials',
        msg: 'Invalid login credentials',
        message: 'Invalid login credentials',
        error_description: 'Invalid login credentials'
      })
    }));

    await page.click('#signInBtn');
    await page.fill('#authEmail', 'mou@liftr.test');
    await page.fill('#authPass', 'nope');

    expect(await page.evaluate(() => submitAuth())).toBe(false);

    await expect(page.locator('#authError')).toHaveText('Invalid login credentials');
    await expect(page.locator('#authModal')).toHaveClass(/show/);
    await expect(page.locator('#authSubmit')).toHaveText('Sign in');
    await expect(page.locator('#authSubmit')).toBeEnabled();
    expect(await page.evaluate(() => window.socialUser)).toBeNull();
    await expect(page.locator('#tabFeedBtn')).toBeVisible();  /* F : toujours visible */
  });

  test('création de compte : bascule du formulaire puis endpoint signup', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    const seen = authRoutes(page);

    await page.click('#signInBtn');
    await page.click('#authToggle');

    await expect(page.locator('#authTitle')).toHaveText('Create account');
    await expect(page.locator('#authSubmit')).toHaveText('Create account');
    await expect(page.locator('#authToggle')).toHaveText('I already have an account');
    expect(await page.evaluate(() => document.getElementById('authPass').getAttribute('autocomplete')))
      .toBe('new-password');

    await page.fill('#authEmail', 'new@liftr.test');
    await page.fill('#authPass', 'secret123');
    expect(await page.evaluate(() => submitAuth())).toBe(true);

    expect(seen.length).toBe(1);
    expect(seen[0]).toContain('/auth/v1/signup');
    expect(await page.evaluate(() => window.socialUser && window.socialUser.email)).toBe('new@liftr.test');
    await expect(page.locator('#tabFeedBtn')).toBeVisible();
  });
});
