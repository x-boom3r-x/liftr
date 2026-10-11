const { test, expect } = require('@playwright/test');
const { seed, today } = require('./helpers');
const { ME, ANA, withSocial, signedIn, consoleWatch,
  openFeed, post, mockApi } = require('./social-mock');

/* Chantier H : partager un exploit / une séance / un programme.
   Le composer du Feed s'ouvre pré-rempli (kind + attachment) ; la carte
   .share-embed se rend dans le fil uniquement si l'attachement passe la
   validation de réception (whitelist, bornes, textContent échappé). */

test.describe('Chantier H : partage exploit / séance / programme', () => {

  test('record : bouton ↗ → composer pré-rempli → post avec carte .pr dorée', async ({ page }) => {
    const api = mockApi(page);
    await withSocial(page);
    await seed(page, {
      prs: { 'back squat': { name: 'Back Squat', weight: 142.5, reps: 3, date: today() } },
      prLog: [{ date: today(), key: 'back squat', name: 'Back Squat',
        weight: 142.5, reps: 3, assisted: 0, prev: { weight: 140, reps: 3 } }]
    });
    await signedIn(page);

    await page.locator('.tabbar .tab[data-tab="gym"]').click();
    await page.locator('#rootSubnav [data-tab="stats"]').click();
    const card = page.locator('.pr-card').first();
    await expect(card).toBeVisible();
    await card.locator('.pr-share').click();

    /* composer ouvert, bannière = aperçu de la carte */
    await expect(page.locator('#tab-feed')).toBeVisible();
    const banner = page.locator('#shareBanner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.share-embed.pr')).toHaveCount(1);
    await expect(banner.locator('.se-title')).toHaveText('Back Squat');

    await page.locator('#postBody').fill('New PR!');
    await page.locator('#postSubmit').click();

    const cardInFeed = page.locator('#feedList .post').first();
    await expect(cardInFeed.locator('.post-body')).toHaveText('New PR!');
    await expect(cardInFeed.locator('.share-embed.pr')).toHaveCount(1);
    await expect(cardInFeed.locator('.se-title')).toHaveText('Back Squat');
    await expect(cardInFeed.locator('.se-big')).toContainText('142.5');
    await expect(cardInFeed.locator('.se-meta')).toContainText('e1RM');

    const inserts = api.calls.filter(c =>
      c.method === 'POST' && c.url.includes('/rest/v1/posts'));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(String(inserts[0].body)).toContain('"kind":"pr"');
    expect(String(inserts[0].body)).toContain('"type":"pr"');
  });

  test('fin de séance : bouton ↗ de la notif → carte .session, sans note privée', async ({ page }) => {
    mockApi(page);
    await withSocial(page);
    await seed(page, {
      history: [{ id: 'h1', date: today(), dayName: 'Push A', dayId: 'd1',
        startedAt: Date.now() - 3600000, endedAt: Date.now() - 120000,
        note: 'Private note', totalSets: 8, volume: 9850, performed: 1,
        exercises: [
          { name: 'Bench', sets: [{ weight: 80, reps: 5 }, { weight: 85, reps: 3 }] },
          { name: 'Run', cardio: true, sets: [{ cardio: true, min: 20, km: 4 }] }
        ] }]
    });
    await signedIn(page);

    /* la notif de fin de séance est le résumé (motivation.js) */
    await page.evaluate(() => showSessionComment(DB.history[0], 1, '8 sets · 9,850 kg volume'));
    await expect(page.locator('#liftrNotif')).toHaveClass(/show/);
    const share = page.locator('#liftrShare');
    await expect(share).toBeVisible();
    await share.click();

    await expect(page.locator('#tab-feed')).toBeVisible();
    const banner = page.locator('#shareBanner');
    await expect(banner.locator('.share-embed.session')).toHaveCount(1);
    await expect(banner.locator('.se-title')).toContainText('Push A');
    await expect(banner).toContainText('Duration');
    await expect(banner).toContainText('58 min');
    await expect(banner).toContainText('9.8k kg');
    /* confidentialité : la note privée ne part jamais */
    await expect(banner).not.toContainText('Private note');

    await page.locator('#postSubmit').click();
    const inFeed = page.locator('#feedList .post').first();
    await expect(inFeed.locator('.share-embed.session')).toHaveCount(1);
    await expect(inFeed).not.toContainText('Private note');
  });

  test('programme : bouton ↗ de la carte → composer avec .program violet', async ({ page }) => {
    mockApi(page);
    await withSocial(page);
    await seed(page, {
      programme: [
        { id: 'd1', name: 'Push', type: 'PUSH', exercises: [{ id: 'e1', name: 'Bench' }, { id: 'e2', name: 'OHP' }] },
        { id: 'd2', name: 'Pull', type: 'PULL', exercises: [{ id: 'e3', name: 'Row' }] }
      ]
    });
    await signedIn(page);

    await page.locator('.tabbar .tab[data-tab="gym"]').click();
    await page.locator('#rootSubnav [data-tab="programme"]').click();
    await page.locator('#daysList .card').first().locator('.icon-btn[aria-label="Share program"]').click();

    await expect(page.locator('#tab-feed')).toBeVisible();
    const banner = page.locator('#shareBanner');
    await expect(banner.locator('.share-embed.program')).toHaveCount(1);
    await expect(banner.locator('.se-title')).toContainText('2 days');
    await expect(banner.locator('.se-cta')).toHaveText('Import this program');
  });

  test('CTA « Import this program » : conversion vers l’import existant, merge sans écrasement', async ({ page }) => {
    mockApi(page, {
      posts: [post(0, ANA, {
        attachment: { v: 1, type: 'program', name: 'PPL 6 days', days: [
          { name: 'Push X', exercises: [{ name: 'Bench', sets: 4, reps: '6-10' }] },
          { name: 'Legs Y', exercises: [{ name: 'Squat', sets: 3 }] }
        ] }
      })]
    });
    await withSocial(page);
    await seed(page, {
      programme: [{ id: 'd1', name: 'Push', type: 'PUSH', exercises: [{ id: 'e1', name: 'Bench' }] }]
    });
    await signedIn(page);
    await openFeed(page);

    const embed = page.locator('#feedList .share-embed.program').first();
    await expect(embed).toBeVisible();
    await expect(embed).toContainText('2 days');
    await embed.locator('.se-cta').click();

    await expect(page.locator('#importModal')).toBeVisible();
    await expect(page.locator('#importHint')).toHaveClass(/ok/);
    await page.locator('#importBtn').click();
    await expect(page.locator('#importModal')).not.toBeVisible();

    /* merge : le jour local est conservé, les jours partagés ajoutés */
    const prog = await page.evaluate(() => DB.programme.map(d => d.name));
    expect(prog).toEqual(['Push', 'Push X', 'Legs Y']);
  });

  test('validation réception : attachement invalide = post sans carte, zéro exception', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [
        post(0, ANA, {
          attachment: { v: 1, type: 'pr', exercise: '<img src=x onerror=alert(1)>',
            kg: 'NaN', reps: 3, junk: 'x' }
        }),
        post(1, ANA, {
          attachment: { v: 2, type: 'pr', exercise: 'Too new', kg: 100, reps: 5 }
        }),
        post(2, ANA, {
          attachment: { v: 1, type: 'mystery', name: 'Unknown kind' }
        }),
        post(3, ANA, {
          attachment: Object.assign({ v: 1, type: 'pr', exercise: 'Big', kg: 100, reps: 5 },
            { blob: 'a'.repeat(20000) })
        }),
        post(4, ANA, { attachment: 'not-an-object' })
      ]
    });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    await expect(page.locator('#feedList .post')).toHaveCount(5);
    await expect(page.locator('#feedList .share-embed')).toHaveCount(0);
    /* les posts restent affichés (texte intact) */
    await expect(page.locator('#feedList .post-body').first()).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('validation réception : champs inconnus ignorés, chaînes niquées, carte correcte', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [post(0, ANA, {
        attachment: { v: 1, type: 'pr', exercise: 'Deadlift', kg: 180, reps: 1,
          e1rm: 186, prevE1rm: 180, date: today(), __proto__polluted: true,
          evil: { toString(){ throw new Error('nope'); } } }
      })]
    });
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    const embed = page.locator('#feedList .share-embed.pr').first();
    await expect(embed).toBeVisible();
    await expect(embed.locator('.se-title')).toHaveText('Deadlift');
    await expect(embed.locator('.se-meta')).toContainText('+6 kg');
    expect(errs).toEqual([]);
  });

  test('annulation : ✕ de la bannière vide le draft, le bouton Post se re-verrouille', async ({ page }) => {
    mockApi(page);
    await withSocial(page);
    await seed(page, {
      prs: { 'bench': { name: 'Bench', weight: 100, reps: 1, date: today() } }
    });
    await signedIn(page);

    await page.locator('.tabbar .tab[data-tab="gym"]').click();
    await page.locator('#rootSubnav [data-tab="stats"]').click();
    await page.locator('.pr-card .pr-share').first().click();
    await expect(page.locator('#shareBanner')).toBeVisible();
    await expect(page.locator('#postSubmit')).toBeEnabled();

    await page.locator('#shareBanner .share-banner-x').click();
    await expect(page.locator('#shareBanner')).toBeHidden();
    await expect(page.locator('#postSubmit')).toBeDisabled();
  });
});
