const { test, expect } = require('@playwright/test');
const { seed, daysAgo } = require('./helpers');

const dayA = { id: 'd1', name: 'PUSH', type: 'PUSH', exercises: [{ id: 'e1', name: 'Développé couché' }] };

/* écran d'accueil : aucun profil connecté */
async function openWelcome(page){
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('at_profiles', JSON.stringify(['Mouataz', 'Riad']));
  });
  await page.reload();
  await page.waitForSelector('#welcomeScreen:not(.hidden)');
}

/* simule un beforeinstallprompt Chrome (prompt + userChoice pilotés par le test) */
async function fireInstallPrompt(page, outcome = 'accepted'){
  await page.evaluate(o => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    window.__prompted = false;
    window.__outcome = null;
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: o, platform: 'web' });
    window.dispatchEvent(e);
  }, outcome);
}

test.describe('PWA', () => {

  test('le bouton d\'installation n\'apparaît qu\'après beforeinstallprompt', async ({ page }) => {
    await openWelcome(page);
    await expect(page.locator('#installBtn')).toBeHidden();

    await fireInstallPrompt(page);
    await expect(page.locator('#installBtn')).toBeVisible();

    await fireInstallPrompt(page, 'dismissed');
    await expect(page.locator('#installBtn')).toBeVisible();
  });

  test('le clic installe (prompt appelé) puis masque le bouton', async ({ page }) => {
    await openWelcome(page);
    await fireInstallPrompt(page);
    await expect(page.locator('#installBtn')).toBeVisible();

    await page.locator('#installBtn').click();
    await expect.poll(() => page.evaluate(() => window.__prompted)).toBe(true);
    await expect(page.locator('#installBtn')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('installed');
  });

  test('appinstalled referme le bouton', async ({ page }) => {
    await openWelcome(page);
    await fireInstallPrompt(page);
    await expect(page.locator('#installBtn')).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(page.locator('#installBtn')).toBeHidden();
  });

  test('le manifest est complet (standalone, 4 raccourcis, icônes)', async ({ page }) => {
    await openWelcome(page);
    const res = await page.request.get('/manifest.json');
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m.name).toContain('Liftr');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toContain('index.html');
    expect(m.shortcuts.map(s => s.name)).toEqual(['Program', 'New session', 'Calendar', 'Progress']);
    const sizes = m.icons.map(i => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('service worker enregistré et actif', async ({ page }) => {
    await seed(page, {}, 'Mouataz');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cache = await page.evaluate(async () => {
      const keys = await caches.keys();
      return keys.filter(k => k.startsWith('liftr-'));
    });
    expect(cache.length).toBe(1);
    expect(cache[0]).toMatch(/^liftr-v\d+$/);
  });

  test('battre un record fait vibrer l\'appareil', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await seed(page, {
      programme: [dayA],
      prs: { 'développé couché': { name: 'Développé couché', weight: 60, reps: 5, assisted: 0, date: daysAgo(3) } },
      active: { id: 'a1', dayId: 'd1', dayName: 'PUSH', startedAt: Date.now(), note: '',
                exercises: [{ id: 'e1', name: 'Développé couché', sets: [{ weight: 62.5, reps: 5, assisted: 0 }] }] }
    }, 'Mouataz');

    await page.evaluate(() => {
      window.__vib = false;
      try { navigator.vibrate = () => { window.__vib = true; return true; }; }
      catch (e){ Object.defineProperty(navigator, 'vibrate', { value: () => { window.__vib = true; return true; }, configurable: true }); }
    });

    await page.locator('#tab-seance button:has-text("Resume")').first().click();
    await expect(page.locator('#activeModal')).toHaveClass(/show/);
    await page.locator('#activeModal button:has-text("Finish session")').click();
    await expect.poll(() => page.evaluate(() => window.__vib)).toBe(true);
    expect(await page.evaluate(() => DB.prs['développé couché'].weight)).toBe(62.5);
  });
});
