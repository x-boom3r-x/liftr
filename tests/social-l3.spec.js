const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, withSocial, signedIn, consoleWatch,
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
    body: JSON.stringify({ results: list })
  }));
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

test.describe('L3 : token !m (autoplay désactivable par pion)', () => {

  test('pion !m : lu par splitMusic, chip muette, withMusic ré-émet', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [
      post(0, ME.id, { body: 'Muted here ♪1234567890@5-20!m' }),
      post(1, ME.id, { body: 'Loud here ♪1234567890' })
    ] });

    await openFeed(page);
    const chips = page.locator('#feedList .post-music .mchip');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toHaveAttribute('data-muted', '1');
    await expect(chips.nth(0)).toHaveClass(/is-muted/);
    await expect(chips.nth(1)).not.toHaveAttribute('data-muted', /.*/);

    /* corpus du pion : !m seul, !m + extrait, ancien format intact */
    const r = await page.evaluate(() => ({
      muted: window.splitMusic('Hi ♪1234567890@5-20!m'),
      bare: window.splitMusic('Hi ♪1234567890!m'),
      old: window.splitMusic('Hi ♪1234567890@5-20'),
      with: window.withMusic('Hello', '1234567890', { start: 5, end: 20, muted: true }),
      without: window.withMusic('Hello', '1234567890', { start: 5, end: 20 })
    }));
    expect(r.muted).toMatchObject({ text: 'Hi', trackId: '1234567890', start: 5, end: 20, muted: true });
    expect(r.bare).toMatchObject({ text: 'Hi', trackId: '1234567890', start: 0, end: 0, muted: true });
    expect(r.old).toMatchObject({ text: 'Hi', trackId: '1234567890', start: 5, end: 20, muted: false });
    expect(r.with).toBe('Hello ♪1234567890@5-20!m');
    expect(r.without).toBe('Hello ♪1234567890@5-20');
    expect(errs).toEqual([]);
  });

  test('composeur : Autoplay on/off encode ou supprime !m dans le pion', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    const api = mockApi(page);

    await openFeed(page);

    /* autoplay off → pion muet encodé */
    await page.locator('#postMusicBtn').click();
    await searchAndPick(page, 'Neon Skyline');
    await page.locator('#musicUseBtn').click();
    await expect(page.locator('#postMusicSlot [data-mauto]')).toHaveText('Autoplay on');
    await page.locator('#postMusicSlot [data-mauto]').click();
    await expect(page.locator('#postMusicSlot [data-mauto]')).toHaveText('Autoplay off');
    await page.locator('#postBody').fill('Silent session');
    await page.locator('#postSubmit').click();
    await expect.poll(() => api.st.posts.length).toBe(3);
    expect(api.st.posts[0].body).toBe('Silent session ♪1234567890@0-15!m');

    /* autoplay on (défaut) → pas de !m */
    await page.locator('#postMusicBtn').click();
    await searchAndPick(page, 'Neon Skyline');
    await page.locator('#musicUseBtn').click();
    await page.locator('#postBody').fill('Loud session');
    await page.locator('#postSubmit').click();
    await expect.poll(() => api.st.posts.length).toBe(4);
    expect(api.st.posts[0].body).toBe('Loud session ♪1234567890@0-15');
    expect(errs).toEqual([]);
  });
});

test.describe('L3 : bouton mute global (bas droite)', () => {

  test('silencieux par défaut ; 🔊 lance l’autoplay visible ; 🔇 coupe (persisté)', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [post(0, ME.id, { body: 'Solo ♪1234567890' })] });

    await openFeed(page);
    await expect(page.locator('#feedList .post-music .mchip')).toHaveCount(1);

    /* bouton visible dès qu'une chip est en viewport, mais rien ne joue */
    await expect(page.locator('#musicMute')).toBeVisible();
    await expect(page.locator('#musicMute')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.musicPlayingId())).toBe(null);

    /* 🔊 : le contenu visible démarre, choix persisté ('0' = son activé) */
    await page.locator('#musicMute').click();
    await expect.poll(() => page.evaluate(() => window.musicPlayingId())).toBe('1234567890');
    expect(await page.evaluate(() => localStorage.getItem('liftr_music_muted'))).toBe('0');
    await expect(page.locator('#musicMute')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(1);

    /* 🔇 : stop immédiat, choix persisté ('1') */
    await page.locator('#musicMute').click();
    await expect.poll(() => page.evaluate(() => window.musicPlayingId())).toBe(null);
    await expect.poll(() => page.evaluate(() => window.__playing().length)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('liftr_music_muted'))).toBe('1');
    expect(errs).toEqual([]);
  });

  test('pion !m : jamais lu en autoplay, même avec le son activé', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    mockApi(page, { posts: [post(0, ME.id, { body: 'Hush ♪1234567890@0-15!m' })] });

    await openFeed(page);
    await page.locator('#musicMute').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('liftr_music_muted'))).toBe('0');
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.musicPlayingId())).toBe(null);

    /* le ▶ manuel reste possible sur un pion muet */
    await page.locator('#feedList .post-music [data-mplay]').first().click();
    await expect.poll(() => page.evaluate(() => window.musicPlayingId())).toBe('1234567890');
    expect(errs).toEqual([]);
  });
});

test.describe('L3 : autoplay story', () => {

  test('slide sonore puis slide muet : le son suit le slide, stop à la fermeture', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    /* un post avec pion musique rend le bouton 🔇 visible (pattern IG) ;
       les stories s'affichent du plus ancien au plus récent :
       slide 1 = Earlier ( audible ), slide 2 = Later ( pion muet ) */
    mockApi(page, {
      posts: [post(0, ME.id, { body: 'Session ♪9876543210' })],
      stories: [
        story(0, ME.id, { body: 'Later ♪1234567890@0-15!m' }),
        story(1, ME.id, { body: 'Earlier ♪9876543210' })
      ]
    });

    await openFeed(page);
    /* on attend hydrateMusic : les chips du feed (post_saves) sont
       prêtes, donc le bouton 🔇 est visible et cliquable (comme IG) */
    await expect(page.locator('.mchip[data-track] [data-mplay]').first())
      .toBeVisible({ timeout: 10000 });
    await page.evaluate(() => window.setGlobalMuted(false));

    await page.evaluate(() => window.openStoryViewer());
    await expect(page.locator('#storyView')).toHaveClass(/show/);
    /* slide 1 : pion audible → autoplay (resolveTrack async). On
       verrouille aussi le DOM sur « Earlier » : la slide auto-avance
       au bout de 5 s, ce qui stopperait le son avant la constatation. */
    await expect(page.locator('#svStage .sv-caption')).toContainText('Earlier');
    await expect.poll(() => page.evaluate(() => window.musicPlayingId()),
      { timeout: 10000 }).toBe('9876543210');

    /* slide suivant : pion muet → silence */
    await page.locator('#svStage .sv-tap.right').click();
    await expect(page.locator('#svStage .sv-caption')).toContainText('Later');
    await expect.poll(() => page.evaluate(() => window.musicPlayingId()),
      { timeout: 10000 }).toBe(null);

    await page.evaluate(() => window.closeStoryViewer());
    await expect(page.locator('#storyView')).not.toHaveClass(/show/);
    await expect.poll(() => page.evaluate(() => window.musicPlayingId())).toBe(null);
    expect(errs).toEqual([]);
  });
});

test.describe('L3 : page Musique + sauvegarde', () => {

  test('tap sur la chip → utilisations (post + story), save local/cloud, rang Saved', async ({ page }) => {
    const errs = consoleWatch(page);
    await fakeAudio(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    const api = mockApi(page, {
      posts: [post(0, ME.id, { body: 'Legs day ♪1234567890' })],
      stories: [story(0, ANA.id, { body: 'Run ♪1234567890' })]
    });

    await openFeed(page);
    /* tap sur le corps de la chip (pas le ▶) → page de la piste */
    await page.locator('#feedList .post-music .mchip').first()
      .click({ position: { x: 70, y: 14 } });
    await expect(page.locator('#trackModal')).toBeVisible();
    await expect(page.locator('#trackHead')).toContainText('Neon Skyline');
    await expect(page.locator('#trackUses .track-row')).toHaveCount(2);
    await expect(page.locator('#trackUses')).toContainText('Stories');
    await expect(page.locator('#trackUses')).toContainText('Posts');

    /* save : localStorage + appel cloud best-effort */
    await page.locator('#trackSaveBtn').click();
    await expect(page.locator('#trackSaveBtn')).toHaveText('Saved ✓');
    expect(await page.evaluate(() => window.isTrackSaved('1234567890'))).toBe(true);
    expect(await page.evaluate(() =>
      JSON.parse(localStorage.getItem('liftr_music_saves') || '[]')
    )).toContain('1234567890');
    await expect.poll(() =>
      api.calls.filter(c => c.url.includes('/music_saves')).length
    ).toBeGreaterThan(0);

    /* unsave puis resave (idempotent) */
    await page.locator('#trackSaveBtn').click();
    await expect(page.locator('#trackSaveBtn')).toHaveText('Save');
    expect(await page.evaluate(() => window.isTrackSaved('1234567890'))).toBe(false);
    await page.locator('#trackSaveBtn').click();
    await expect(page.locator('#trackSaveBtn')).toHaveText('Saved ✓');

    /* rang « Saved » en tête du sélecteur du composeur */
    await page.locator('#trackModal .modal-actions .btn-ghost').click();
    await expect(page.locator('#trackModal')).toBeHidden();
    await page.locator('#postMusicBtn').click();
    await expect(page.locator('#musicList')).toContainText('Saved');
    await expect(page.locator('#musicList .music-row', { hasText: 'Neon Skyline' })).toHaveCount(1);
    await page.locator('#musicModal .modal-actions .btn-ghost').click();
    await expect(page.locator('#musicModal')).toBeHidden();

    /* clic sur la rangée story de la page piste → visionneuse */
    await page.locator('#feedList .post-music .mchip').first()
      .click({ position: { x: 70, y: 14 } });
    await expect(page.locator('#trackModal')).toBeVisible();
    await page.locator('#trackUses .track-row', { hasText: 'Run' }).click();
    await expect(page.locator('#trackModal')).toBeHidden();
    await expect(page.locator('#storyView')).toHaveClass(/show/);
    await page.evaluate(() => window.closeStoryViewer());
    expect(errs).toEqual([]);
  });
});
