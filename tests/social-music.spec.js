const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, withSocial, signedIn, consoleWatch,
  openFeed, post, story, mockApi } = require('./social-mock');

const TRACK_A = {
  trackId: 1234567890, trackName: 'Neon Skyline', artistName: 'The Lifters',
  collectionName: 'Iron Age', artworkUrl100: '',
  previewUrl: 'https://cdn.example/preview-a.m4a', trackTimeMillis: 30000
};
const TRACK_B = {
  trackId: 9876543210, trackName: 'Heavy Doubles', artistName: 'The Spotters',
  collectionName: 'Iron Age', artworkUrl100: '',
  previewUrl: 'https://cdn.example/preview-b.m4a', trackTimeMillis: 30000
};

/* Audio bidon : aucune lecture réseau réelle, on pilote les événements. */
async function fakeAudio(page){
  await page.addInitScript(() => {
    const list = [];
    window.__audios = list;
    window.__playing = () => list.filter(a => !a.paused);
    class FakeAudio {
      constructor(src){
        this.src = src || '';
        this.paused = true;
        this.currentTime = 0;
        this.duration = 30;
        this._h = {};
        list.push(this);
      }
      addEventListener(n, fn){ (this._h[n] = this._h[n] || []).push(fn); }
      removeEventListener(){}
      play(){
        if (window.__audioFail){ this.paused = true; return Promise.reject(new Error('NotAllowedError')); }
        this.paused = false;
        return Promise.resolve();
      }
      pause(){ this.paused = true; }
      removeAttribute(n){ if (n === 'src') this.src = ''; }
      load(){}
      fire(n){ (this._h[n] || []).slice().forEach(fn => { try { fn(); } catch(e){} }); }
    }
    window.Audio = FakeAudio;
  });
}

async function routeMusic(page, tracks){
  const list = tracks || [TRACK_A, TRACK_B];
  await page.route('**/itunes.apple.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ results: list })
  }));
}

/* Deezer (secours JSONP) : vide sans erreur → « No result » testable. */
async function routeDeezer(page, payload){
  await page.route('**/api.deezer.com/**', route => {
    const cb = new URL(route.request().url()).searchParams.get('callback');
    const body = payload === 'down'
      ? { status: 500, contentType: 'text/plain', body: 'down' }
      : { status: 200, contentType: 'application/javascript',
          body: cb + '(' + JSON.stringify(payload || { data: [] }) + ');' };
    return route.fulfill(body);
  });
}

async function searchAndPick(page, title){
  await page.locator('#musicInput').fill('neon');
  await page.locator('#musicSearchBtn').click();
  const row = page.locator('#musicList .music-row', { hasText: title });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(row).toHaveClass(/sel/);
  await expect(page.locator('#musicUseBtn')).toBeEnabled();
}

test.describe('D : sélecteur de musique', () => {

  test('sélection explicite (.sel), extrait réglable, Use / Cancel', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page);

    await openFeed(page);
    await page.locator('#postMusicBtn').click();
    await expect(page.locator('#musicModal')).toBeVisible();
    await expect(page.locator('#musicUseBtn')).toBeDisabled();
    await expect(page.locator('#musicClip')).toBeHidden();

    /* annuler sans sélection : rien ne se place */
    await page.locator('.music-footer .btn-ghost').click();
    await expect(page.locator('#musicModal')).toBeHidden();
    await expect(page.locator('#postMusicSlot')).toBeHidden();

    /* recherche → sélection → extrait 5 s → Use */
    await page.locator('#postMusicBtn').click();
    await searchAndPick(page, 'Neon Skyline');
    await expect(page.locator('#musicClip')).toBeVisible();
    await expect(page.locator('#musicClipOut')).toHaveText('0s → 15s');

    await page.locator('#musicClipRange').fill('5');
    await expect(page.locator('#musicClipOut')).toHaveText('5s → 20s');

    await page.locator('#musicUseBtn').click();
    await expect(page.locator('#musicModal')).toBeHidden();
    const chip = page.locator('#postMusicSlot .mchip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-start', '5');
    await expect(chip).toHaveAttribute('data-end', '20');
    await expect(page.locator('#postMusicSlot .mchip-t')).toHaveText('Neon Skyline');
    expect(errs).toEqual([]);
  });

  test('annuler ne place rien ; l’aperçu s’arrête en fermant', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page);

    await openFeed(page);
    await page.locator('#postMusicBtn').click();
    await searchAndPick(page, 'Heavy Doubles');

    /* aperçu depuis la ligne du sélecteur */
    await page.locator('#musicList .music-play').first().click();
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);

    await page.locator('.music-footer .btn-ghost').click();
    await expect(page.locator('#musicModal')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(0);
    await expect(page.locator('#postMusicSlot')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test('état réseau : aucun résultat et erreur affichée', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);

    /* iTunes vide + Deezer vide → « No result » */
    await routeMusic(page, []);
    await routeDeezer(page, { data: [] });
    await openFeed(page);
    await page.locator('#postMusicBtn').click();
    await page.locator('#musicInput').fill('zzzz nothing');
    await page.locator('#musicSearchBtn').click();
    await expect(page.locator('#musicList')).toContainText('No result');
    await expect(page.locator('#musicError')).toBeHidden();

    /* tout est en échec → message d’erreur réseau */
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await routeMusic(page, []);
    await routeDeezer(page, 'down');
    await page.locator('#musicInput').fill('again');
    await page.locator('#musicSearchBtn').click();
    await expect(page.locator('#musicError')).toBeVisible();
    await expect(page.locator('#musicError')).toContainText('unreachable');
    /* on ignore les erreurs réseau provoquées volontairement par le test */
    expect(errs.filter(e => !/Failed to load resource/.test(e))).toEqual([]);
  });

  test('fermer pendant la recherche annule la requête (AbortController)', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/itunes.apple.com/**', async route => {
      await gate;
      try {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ results: [TRACK_A] })
        });
      } catch(e){ /* requête annulée pendant qu’on attendait */ }
    });
    await routeDeezer(page, { data: [] });

    await openFeed(page);
    await page.locator('#postMusicBtn').click();
    await page.locator('#musicInput').fill('neon');
    await page.locator('#musicSearchBtn').click();
    await expect(page.locator('#musicList')).toContainText('Searching');

    await page.locator('.music-footer .btn-ghost').click();
    await expect(page.locator('#musicModal')).toBeHidden();
    release();
    await page.waitForTimeout(400);

    /* la réponse est arrivée après fermeture : rien n’a été peint */
    await expect(page.locator('#musicList')).not.toContainText('Neon Skyline');
    expect(errs).toEqual([]);
  });
});

test.describe('D : validation du pion ♪id@s-e', () => {

  test('extrait valide, malformé ignoré, ancien format lu, rendu intact', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [
      post(0, ME.id, { body: 'Valid ♪1234567890@5-20' }),
      post(1, ME.id, { body: 'Reversed ♪1234567890@20-5' }),
      post(2, ME.id, { body: 'TooLong ♪1234567890@0-99' }),
      post(3, ME.id, { body: 'Letters ♪1234567890@abc' }),
      post(4, ME.id, { body: 'Classic ♪9876543210' })
    ] });

    await openFeed(page);
    await expect(page.locator('#feedList .post-music')).toHaveCount(5);

    const chips = page.locator('#feedList .post-music .mchip');
    await expect(chips.nth(0)).toHaveAttribute('data-start', '5');
    await expect(chips.nth(0)).toHaveAttribute('data-end', '20');
    await expect(chips.nth(1)).not.toHaveAttribute('data-start', /.*/);
    await expect(chips.nth(2)).not.toHaveAttribute('data-start', /.*/);
    await expect(chips.nth(3)).not.toHaveAttribute('data-start', /.*/);
    await expect(chips.nth(4)).not.toHaveAttribute('data-start', /.*/);

    /* les tokens malformés ont disparu du texte, le corps reste lisible */
    await expect(page.locator('#feedList')).toContainText('Valid');
    await expect(page.locator('#feedList')).toContainText('Reversed');
    await expect(page.locator('#feedList')).toContainText('TooLong');
    await expect(page.locator('#feedList')).toContainText('Letters');
    await expect(page.locator('#feedList')).toContainText('Classic');
    await expect(page.locator('#feedList')).not.toContainText('@abc');
    await expect(page.locator('#feedList')).not.toContainText('@20-5');
    await expect(page.locator('#feedList')).not.toContainText('@0-99');
    expect(errs).toEqual([]);
  });

  test('soumettre un post avec extrait encode ♪id@s-e', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#postMusicBtn').click();
    await searchAndPick(page, 'Neon Skyline');
    await page.locator('#musicClipRange').fill('7');
    await page.locator('#musicUseBtn').click();
    await expect(page.locator('#postMusicSlot')).toBeVisible();

    await page.locator('#postBody').fill('Big pull day');
    await page.locator('#postSubmit').click();
    await expect.poll(() => api.st.posts.length).toBe(3);
    expect(api.st.posts[0].body).toBe('Big pull day ♪1234567890@7-22');
    expect(errs).toEqual([]);
  });
});

test.describe('D : lecteur singleton', () => {

  test('un seul morceau à la fois ; re-rendu garde ▶/❚❚', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [
      post(0, ME.id, { body: 'First ♪1234567890' }),
      post(1, ME.id, { body: 'Second ♪9876543210' })
    ] });

    await openFeed(page);
    const first = page.locator('#feedList .post-music .mchip').nth(0);
    const second = page.locator('#feedList .post-music .mchip').nth(1);
    await first.locator('[data-mplay]').click();
    await expect(first.locator('[data-mplay]')).toHaveClass(/on/);
    await expect(first.locator('.mchip-ico')).toHaveText('❚❚');
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);

    await second.locator('[data-mplay]').click();
    await expect(second.locator('[data-mplay]')).toHaveClass(/on/);
    await expect(first.locator('[data-mplay]')).not.toHaveClass(/on/);
    await expect(first.locator('.mchip-ico')).toHaveText('▶');
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);
    expect(await page.evaluate(() => window.__playing()[0].src)).toContain('preview-b');

    /* re-rendu du fil : l’état « en lecture » survit */
    await page.evaluate(() => window.renderFeed());
    await expect(second.locator('[data-mplay]')).toHaveClass(/on/);
    await expect(second.locator('.mchip-ico')).toHaveText('❚❚');
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);
    expect(errs).toEqual([]);
  });

  test('changement d’onglet coupe la lecture', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [post(0, ME.id, { body: 'Solo ♪1234567890' })] });

    await openFeed(page);
    await page.locator('#feedList .post-music [data-mplay]').first().click();
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);

    await page.evaluate(() => window.showTab('programme'));
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(0);
    expect(await page.evaluate(() => window.musicPlayingId())).toBe(null);
    expect(errs).toEqual([]);
  });

  test('ouvrir un autre modal coupe la lecture', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [post(0, ME.id, { body: 'Solo ♪1234567890' })] });

    await openFeed(page);
    await page.locator('#feedList .post-music [data-mplay]').first().click();
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);

    await page.evaluate(() => window.openModal('peopleModal'));
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(0);
    expect(errs).toEqual([]);
  });

  test('pagehide coupe la lecture', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [post(0, ME.id, { body: 'Solo ♪1234567890' })] });

    await openFeed(page);
    await page.locator('#feedList .post-music [data-mplay]').first().click();
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(0);
    expect(errs).toEqual([]);
  });

  test('play() rejeté : retour au ▶, aucun toast d’erreur', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [post(0, ME.id, { body: 'Blocked ♪1234567890' })] });

    await openFeed(page);
    await page.evaluate(() => { window.__audioFail = true; });
    const play = page.locator('#feedList .post-music [data-mplay]').first();
    await play.click();

    await expect(play).not.toHaveClass(/on/);
    await expect(play.locator('.mchip-ico')).toHaveText('▶');
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(0);
    expect(await page.evaluate(() => window.musicPlayingId())).toBe(null);
    const toast = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return { show: t.classList.contains('show'), text: t.textContent };
    });
    expect(toast.show).toBe(false);
    expect(toast.text).not.toMatch(/unavailable|failed/i);
    expect(errs).toEqual([]);
  });
});

test.describe('D : extrait pendant la lecture', () => {

  test('seek au début de l’extrait puis arrêt à la fin', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [post(0, ME.id, { body: 'Clip ♪1234567890@5-20' })] });

    await openFeed(page);
    await page.locator('#feedList .post-music [data-mplay]').first().click();
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);

    const r = await page.evaluate(() => {
      const a = window.__audios[window.__audios.length - 1];
      a.currentTime = 0;
      a.fire('loadedmetadata');
      const seeked = a.currentTime;
      a.currentTime = 20;
      a.fire('timeupdate');
      return { seeked, paused: a.paused, id: window.musicPlayingId() };
    });
    expect(r.seeked).toBe(5);
    expect(r.paused).toBe(true);
    expect(r.id).toBe(null);
    await expect(page.locator('#feedList .post-music [data-mplay]').first())
      .not.toHaveClass(/on/);
    expect(errs).toEqual([]);
  });

  test('story : lecture dans la visionneuse, arrêt à la fermeture', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { stories: [story(0, ME.id, { body: 'Night run ♪1234567890' })] });

    await openFeed(page);
    await page.evaluate(() => window.openStoryViewer());
    await expect(page.locator('#storyView')).toHaveClass(/show/);
    await expect(page.locator('#svStage .sv-caption')).toContainText('Night run');

    const play = page.locator('#svStage .sv-music [data-mplay]');
    await expect(play).toHaveCount(1);
    await play.click();
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);

    await page.evaluate(() => window.closeStoryViewer());
    await expect(page.locator('#storyView')).not.toHaveClass(/show/);
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(0);
    expect(errs).toEqual([]);
  });
});
