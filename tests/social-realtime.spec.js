const { test, expect } = require('@playwright/test');
const { withSocial, signedIn, openFeed, mockApi, post, consoleWatch, seed } =
  require('./social-mock');

test.describe('Realtime : pastille « New posts » + pas de websocket en test', () => {

  test('realtime désactivé : aucun canal, zéro erreur console', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);            /* MOCK_CONFIG porte realtime:false */
    await seed(page, {});
    await signedIn(page);              /* restoreSession appelle startRealtime */
    mockApi(page, { posts: [post(0)] });
    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(1);

    /* refus net et silencieux — aucune WebSocket n'est ouverte */
    const started = await page.evaluate(() => window.startRealtime('user-test'));
    expect(started).toBe(false);
    expect(errs).toEqual([]);
  });

  test('pastille : visible hors haut du fil, masquée après refresh', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, { posts: [post(0), post(1), post(2)] });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(3);
    await expect(page.locator('#feedNewPill')).toBeHidden();

    /* défilé vers le bas : un nouveau post ne s'injecte pas en tête → pastille */
    await page.evaluate(() => { document.querySelector('.app').scrollTop = 200; });
    await page.evaluate(() => window.__liftrFeedSignal());
    await expect(page.locator('#feedNewPill')).toBeVisible();

    /* le clic recharge le fil et masque la pastille */
    await page.evaluate(() => window.refreshFeedNew());
    await expect(page.locator('#feedNewPill')).toBeHidden();
    await expect(page.locator('#feedList .post')).toHaveCount(3);
  });

  test('en haut du fil : le signal recharge directement, sans pastille', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, { posts: [post(0), post(1)] });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(2);

    /* en haut (scrollTop 0) : refresh immédiat, la pastille ne paraît pas */
    await page.evaluate(() => window.__liftrFeedSignal());
    await expect(page.locator('#feedNewPill')).toBeHidden();
    await expect(page.locator('#feedList .post')).toHaveCount(2);
  });
});
