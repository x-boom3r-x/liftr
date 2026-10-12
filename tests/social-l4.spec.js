const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, ME_P, ANA_P, withSocial, signedIn, consoleWatch,
  openFeed, post, mockApi } = require('./social-mock');

/* Conversation déjà ouverte entre ME et ANA : le thread se remplit
   sans dépendre de la création asynchrone d'une conversation. */
const CONV = {
  id: 'conv-ana', user_a: ME.id, user_b: ANA,
  last_message_at: new Date().toISOString(),
  last_preview: null, last_sender_id: null
};

/* Une conversation existante mais vide, pour l'envoi d'un partage. */
const CONV_EMPTY = {
  id: 'conv-empty', user_a: ME.id, user_b: ANA,
  last_message_at: new Date().toISOString(),
  last_preview: null, last_sender_id: null
};

function openThreadDirect(page, peerId){
  return page.evaluate(id => window.openThread(id), peerId);
}

test.describe('L4 : envoyer un post en message', () => {

  test('bulle : « #p=<id> » rend un bouton Open post ; autre texte intact', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      convos: [CONV],
      msgs: [
        { id: 'm1', conversation_id: CONV.id, sender_id: ANA,
          body: 'Check this #p=post-1', created_at: new Date().toISOString(), read_at: null },
        { id: 'm2', conversation_id: CONV.id, sender_id: ME.id,
          body: 'Just a #hashtag and no link', created_at: new Date().toISOString(), read_at: null }
      ]
    });

    await openThreadDirect(page, ANA);
    const link = page.locator('#threadList .bub-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('data-deeplink-post', 'post-1');
    await expect(link).toHaveText(/Open post/);
    /* le reste de la bulle garde son texte brut (dièses non-likés) */
    await expect(page.locator('#threadList .bub').nth(1))
      .toContainText('Just a #hashtag and no link');
    expect(errs).toEqual([]);
  });

  test('tap sur le lien → révèle le post au-dessus des commentaires', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      posts: [post(0, ME.id, { body: 'My heavy single' })],
      convos: [CONV],
      msgs: [
        { id: 'm1', conversation_id: CONV.id, sender_id: ANA,
          body: 'Seen this? #p=post-0', created_at: new Date().toISOString(), read_at: null }
      ]
    });

    await openFeed(page);
    await openThreadDirect(page, ANA);
    await page.locator('#threadList .bub-link').click();
    /* le lien révèle le post : on revient au fil et la carte s'ouvre */
    await expect(page.locator('#commentsModal')).toBeVisible();
    await expect(page.locator('#commentsPost')).toContainText('My heavy single');
    expect(errs).toEqual([]);
  });

  test('lien vers un post supprimé → messagerie, jamais d\'exception', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      posts: [],
      convos: [CONV],
      msgs: [
        { id: 'm1', conversation_id: CONV.id, sender_id: ANA,
          body: 'Ghost #p=post-gone', created_at: new Date().toISOString(), read_at: null }
      ]
    });

    await openFeed(page);
    await openThreadDirect(page, ANA);
    await page.locator('#threadList .bub-link').click();
    /* post absent : on reste dans la messagerie, pas de crash */
    await expect(page.locator('#commentsModal')).toBeHidden();
    await expect(page.locator('#toast')).toHaveClass(/show/);
    expect(errs).toEqual([]);
  });

  test('envoi : le sélecteur choisit un ami, le composer porte le lien', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, {
      posts: [post(0, ME.id, { body: 'Squat PR day' })],
      people: [ANA_P, ME_P],
      convos: [CONV_EMPTY],
      msgs: []
    });

    await openFeed(page);
    /* « Send in message » sur le partage d'un post → feuille d'amis */
    await page.evaluate(() => window.sharePostInMessage('post-0'));
    await expect(page.locator('#actionSheet')).toBeVisible();
    await expect(page.locator('#asList')).toContainText('Ana');
    await page.locator('#asList button', { hasText: 'Ana' }).click();

    /* la discussion s'ouvre pré-remplie avec le lien du post */
    await expect(page.locator('#threadList .bub')).toHaveCount(0); /* thread vide */
    await expect(page.locator('#threadBody')).toHaveValue('#p=post-0');
    await expect(page.locator('#threadSend')).toBeEnabled();

    /* l'envoi écrit le message avec le lien intact */
    await page.locator('#threadSend').click();
    await expect.poll(() =>
      api.calls.filter(c => c.method === 'POST' && c.url.includes('/messages')).length
    ).toBe(1);
    const insert = JSON.parse(api.calls
      .filter(c => c.method === 'POST' && c.url.includes('/messages'))[0].body);
    expect(insert.body).toBe('#p=post-0');
    expect(errs).toEqual([]);
  });

  test('deep-link #p=<id> au chargement → révèle le post (hors messagerie)', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      posts: [post(0, ME.id, { body: 'From a shared link' })]
    });

    await openFeed(page);
    await page.evaluate(() => { location.hash = '#p=post-0'; });
    await expect(page.locator('#commentsModal')).toBeVisible();
    await expect(page.locator('#commentsPost')).toContainText('From a shared link');
    expect(errs).toEqual([]);
  });
});
