const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { mockApi, ME, withSocial, signedIn, consoleWatch, openFeed } = require('./social-mock');

/* ------------------------------------------------------------------
   L1 — notes réparées : la table notes (migration v3) n'a QUE
   id/author_id/body/created_at/expires_at. Le mock rejette comme le
   vrai PostgREST (PGRST204) toute colonne inconnue en SELECT ou en
   INSERT : impossible de régresser vers updated_at sans casser ici.
   ------------------------------------------------------------------ */

test.describe('L1 : notes (table v3 sans updated_at)', () => {

  test('poster une note : POST limité aux colonnes réelles, pas d’erreur', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openNoteComposer());
    await expect(page.locator('#noteModal')).toBeVisible();
    await page.locator('#noteBody').fill('Legs day PR 140');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();
    await expect.poll(() => api.st.notes.length).toBe(1);

    const call = api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/notes'));
    expect(call).toBeTruthy();
    const sent = JSON.parse(call.body);
    expect(Object.keys(sent).sort()).toEqual(['author_id', 'body', 'expires_at']);
    expect(api.st.notes[0].body).toBe('Legs day PR 140');
    expect(errs).toEqual([]);
  });

  test('repost : created_at d’origine préservé + clip musique repacké', async ({ page }) => {
    const created = new Date(Date.now() - 3600000).toISOString();
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, {
      notes: [{
        id: 'note-1', author_id: ME.id, body: 'Pull day ♪1234567890@5-20',
        created_at: created, expires_at: new Date(Date.now() + 6 * 86400000).toISOString()
      }]
    });

    await openFeed(page);
    await page.locator('#socialNav [data-view="inbox"]').click();
    /* renderNotes est async : on attend que la note seedée soit peinte */
    await expect(page.locator('#notesRow [data-note="me"]')).toBeVisible();
    await page.evaluate(() => openNoteComposer());
    await expect(page.locator('#noteModal')).toBeVisible();
    /* le clip @5-20 est restauré dans le slot du composeur */
    await expect(page.locator('#noteMusicSlot .mchip')).toBeVisible();
    await page.locator('#noteBody').fill('Pull day, heavier');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();
    await expect.poll(() => api.st.notes[0].body).toContain('♪1234567890@5-20');
    expect(api.st.notes[0].created_at).toBe(created);
  });

  test('note « forever » : le segment Forever est actif à la réouverture', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page, {
      notes: [{
        id: 'note-2', author_id: ME.id, body: 'Here for good',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 100 * 365 * 86400000).toISOString()
      }]
    });

    await openFeed(page);
    await page.locator('#socialNav [data-view="inbox"]').click();
    /* renderNotes est async : on attend que la note seedée soit peinte */
    await expect(page.locator('#notesRow [data-note="me"]')).toBeVisible();
    await page.evaluate(() => openNoteComposer());
    await expect(page.locator('#noteModal')).toBeVisible();
    await expect(page.locator('#noteDur [data-dur="0"]')).toHaveClass(/active/);
  });
});
