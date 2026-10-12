/* Chantier L5 : comptes privés (demandes à valider), commentaires
   on/off côté propriétaire, fils de réponse (parent_id / root_id) et
   repli de la liste (« View N comments »). */
const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');
const { ME, ANA, ME_P, ANA_P, withSocial, signedIn, openFeed, post,
  mockApi, consoleWatch } = require('./social-mock');

const KEN = '33333333-3333-4333-8333-333333333333';
const KEN_P = {
  id: KEN, username: 'ken', display_name: 'Ken', avatar_url: null,
  bio: 'Deadlift day', created_at: new Date(Date.now() - 7200000).toISOString()
};

function cmt(id, postId, authorId, body){
  return {
    id: id, post_id: postId, author_id: authorId, body: body,
    created_at: new Date().toISOString(), deleted_at: null,
    author: authorId === ANA
      ? { id: ANA, username: 'ana', display_name: 'Ana', avatar_url: null }
      : { id: ME.id, username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
  };
}

async function goProfile(page){
  await openFeed(page);
  await page.locator('#socialNav [data-view="profile"]').click();
  await expect(page.locator('#view-profile')).toBeVisible();
  await expect(page.locator('#profName')).toHaveText('Mouataz');
}

test.describe('Chantier L5 : comments on/off, fils, comptes privés', () => {

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withSocial(page);
    await seed(page, { programme: [], history: [] }, 'Mouataz');
    await signedIn(page);
  });

  test('repli : « View N comments » plie et déplie, ✕ ferme', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [post(0, ANA)],
      people: [ANA_P, ME_P],
      comments: [cmt('c1', 'post-0', ANA, 'Solid.'),
        cmt('c2', 'post-0', ME.id, 'Thanks!')]
    });

    await openFeed(page);
    await page.locator('.post[data-post="post-0"] [data-act="reply"]').click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    await expect(page.locator('#commentsSub')).toHaveText('2 comments');
    await expect(page.locator('#commentsToggle')).toHaveText('View 2 comments');
    await expect(page.locator('#commentList')).toBeHidden();

    await page.locator('#commentsToggle').click();
    await expect(page.locator('#commentsToggle')).toHaveText('Hide comments');
    await expect(page.locator('#commentList')).toBeVisible();
    await expect(page.locator('#commentList .comment')).toHaveCount(2);

    await page.locator('#commentsToggle').click();
    await expect(page.locator('#commentList')).toBeHidden();
    await expect(page.locator('#commentsToggle')).toHaveText('View 2 comments');

    await page.locator('#commentsCloseBtn').click();
    await expect(page.locator('#commentsModal')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test('réponse : chip Reply, parent_id/root_id, indentation 16px', async ({ page }) => {
    const errs = consoleWatch(page);
    const api = mockApi(page, {
      posts: [post(0, ANA)],
      people: [ANA_P, ME_P],
      comments: [cmt('cmt-seed', 'post-0', ANA, 'Nice set!')]
    });

    await openFeed(page);
    await page.locator('.post[data-post="post-0"] [data-act="reply"]').click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    await page.locator('#commentsToggle').click();
    await page.locator('#commentList .comment-reply').first().click();

    await expect(page.locator('#replyChip')).toBeVisible();
    await expect(page.locator('#replyChipText')).toHaveText('Replying to @ana');

    await page.fill('#commentBody', 'Back at you.');
    await expect(page.locator('#commentSubmit')).toBeEnabled();
    await page.locator('#commentSubmit').click();

    await expect(page.locator('#commentList .comment')).toHaveCount(2);
    const ins = api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/comments'));
    expect(ins).toBeTruthy();
    const payload = JSON.parse(ins.body);
    expect(payload.post_id).toBe('post-0');
    expect(payload.parent_id).toBe('cmt-seed');
    expect(payload.root_id).toBe('cmt-seed');

    await expect(page.locator('#replyChip')).toBeHidden();
    await expect(page.locator('#commentBody')).toHaveValue('');
    await expect(page.locator('#commentsSub')).toHaveText('2 comments');
    const style = await page.locator('#commentList .comment').nth(1).getAttribute('style');
    expect(style).toContain('--cd:16px');
    expect(errs).toEqual([]);
  });

  test('comments off : note pour tous, menu du propriétaire on/off', async ({ page }) => {
    const errs = consoleWatch(page);
    const api = mockApi(page, {
      posts: [post(0, ME.id, { comments_enabled: false }), post(1, ME.id)],
      people: [ANA_P, ME_P]
    });

    await openFeed(page);
    await page.locator('.post[data-post="post-0"] [data-act="reply"]').click();
    await expect(page.locator('#commentsModal')).toBeVisible();
    await expect(page.locator('#commentsOff')).toBeVisible();
    await expect(page.locator('#commentCompose')).toBeHidden();
    await expect(page.locator('#commentsToggle')).toBeHidden();
    await page.locator('#commentsCloseBtn').click();
    await expect(page.locator('#commentsModal')).toBeHidden();

    /* le propriétaire rouvre depuis le menu du post */
    await page.locator('#feedList .post-more[data-post="post-0"]').click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await page.locator('#asList .as-item', { hasText: 'Turn on comments' }).click();
    await expect.poll(() => api.st.posts.find(p => p.id === 'post-0').comments_enabled).toBe(true);
    const patch = api.calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/posts'));
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch.body).comments_enabled).toBe(true);

    await page.locator('.post[data-post="post-0"] [data-act="reply"]').click();
    await expect(page.locator('#commentsOff')).toBeHidden();
    await expect(page.locator('#commentCompose')).toBeVisible();
    await expect(page.locator('#commentsToggle')).toBeHidden();
    await expect(page.locator('#commentList .comment-empty'))
      .toHaveText('No comments yet — be the first.');
    await page.locator('#commentsCloseBtn').click();

    /* et referme */
    await page.locator('#feedList .post-more[data-post="post-0"]').click();
    await page.locator('#asList .as-item', { hasText: 'Turn off comments' }).click();
    await expect.poll(() => api.st.posts.find(p => p.id === 'post-0').comments_enabled).toBe(false);
    await page.locator('.post[data-post="post-0"] [data-act="reply"]').click();
    await expect(page.locator('#commentsOff')).toBeVisible();
    await expect(page.locator('#commentCompose')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test('compte privé : Follow → Requested (state pending), re-clic = annulation', async ({ page }) => {
    const errs = consoleWatch(page);
    const api = mockApi(page, {
      posts: [post(0, ME.id)],
      people: [Object.assign({}, ANA_P, { is_private: true }), ME_P],
      follows: []
    });

    await openFeed(page);
    await page.locator('#peopleBtn').click();
    await expect(page.locator('#peopleModal')).toBeVisible();
    await expect(page.locator('#peopleList .person')).toHaveCount(1);
    await expect(page.locator('#peopleList [data-follow]')).toHaveText('Follow');

    await page.locator('#peopleList [data-follow]').click();
    await expect(page.locator('#peopleList [data-follow]')).toHaveText('Requested');
    const ins = api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/follows'));
    expect(ins).toBeTruthy();
    const payload = JSON.parse(ins.body);
    expect(payload.follower_id).toBe(ME.id);
    expect(payload.followee_id).toBe(ANA);
    expect(payload.state).toBe('pending');

    await page.locator('#peopleList [data-follow]').click();
    await expect(page.locator('#peopleList [data-follow]')).toHaveText('Follow');
    const del = api.calls.find(c => c.method === 'DELETE' && c.url.includes('/rest/v1/follows'));
    expect(del).toBeTruthy();
    const du = decodeURIComponent(del.url);
    expect(du).toContain('follower_id=eq.' + ME.id);
    expect(du).toContain('followee_id=eq.' + ANA);
    expect(errs).toEqual([]);
  });

  test('demandes reçues : section Requests, Accept puis Decline', async ({ page }) => {
    const errs = consoleWatch(page);
    const api = mockApi(page, {
      posts: [post(0, ME.id)],
      people: [ANA_P, KEN_P, ME_P],
      follows: [
        { follower_id: ANA, followee_id: ME.id, state: 'pending' },
        { follower_id: KEN, followee_id: ME.id, state: 'pending' }
      ]
    });

    await goProfile(page);
    /* les demandes en attente ne comptent pas comme des followers */
    await expect(page.locator('#statFollowersBtn')).toHaveText('0');

    await page.locator('#statFollowersBtn').click();
    await expect(page.locator('#peopleModal')).toBeVisible();
    await expect(page.locator('#peopleList .people-sec')).toHaveText('Requests');
    await expect(page.locator('#peopleList [data-req]')).toHaveCount(2);
    await expect(page.locator('#peopleList [data-req="' + ANA + '"]')).toHaveCount(1);

    await page.locator('#peopleList [data-req="' + ANA + '"] [data-accept]').click();
    await expect(page.locator('#peopleList [data-req]')).toHaveCount(1);
    const patch = api.calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/follows'));
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch.body).state).toBe('accepted');
    expect(decodeURIComponent(patch.url)).toContain('follower_id=eq.' + ANA);
    await expect(page.locator('#statFollowersBtn')).toHaveText('1');
    /* Ana apparaît maintenant dans la liste des followers */
    await expect(page.locator('#peopleList [data-row] .person-name')).toHaveText('Ana');

    await page.locator('#peopleList [data-req="' + KEN + '"] [data-decline]').click();
    await expect(page.locator('#peopleList [data-req]')).toHaveCount(0);
    await expect(page.locator('#peopleList .people-sec')).toHaveCount(0);
    const del = api.calls.find(c => c.method === 'DELETE' && c.url.includes('/rest/v1/follows'));
    expect(del).toBeTruthy();
    expect(decodeURIComponent(del.url)).toContain('follower_id=eq.' + KEN);
    await expect(page.locator('#peopleList [data-row] .person-name')).toHaveText('Ana');
    expect(errs).toEqual([]);
  });

  test('profil privé : grille verrouillée, bouton Follow → Requested', async ({ page }) => {
    const errs = consoleWatch(page);
    const api = mockApi(page, {
      posts: [post(0, ME.id)],
      people: [Object.assign({}, ANA_P, { is_private: true }), ME_P]
    });

    await openFeed(page);
    await page.evaluate(id => window.openProfile(id), ANA);
    await expect(page.locator('#view-profile')).toBeVisible();
    await expect(page.locator('#profName')).toHaveText('Ana');
    await expect(page.locator('#profGrid')).toContainText('This account is private');
    await expect(page.locator('#profFollowBtn')).toHaveText('Follow');

    await page.locator('#profFollowBtn').click();
    await expect(page.locator('#profFollowBtn')).toHaveText('Requested');
    await expect(page.locator('#profFollowBtn')).toHaveAttribute('data-state', 'pending');
    const ins = api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/follows'));
    expect(ins).toBeTruthy();
    expect(JSON.parse(ins.body).state).toBe('pending');
    expect(errs).toEqual([]);
  });

  test('fil Following : une demande en attente ne suit pas encore', async ({ page }) => {
    const errs = consoleWatch(page);
    mockApi(page, {
      posts: [post(0, ME.id), post(1, ANA)],
      people: [ANA_P, ME_P],
      follows: [{ follower_id: ME.id, followee_id: ANA, state: 'pending' }]
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(2);

    await page.locator('#feedFilter .seg[data-scope="following"]').click();
    await expect(page.locator('#feedList .post')).toHaveCount(0);
    await expect(page.locator('#feedList .feed-empty-t')).toHaveText('No one in your crew yet');
    expect(errs).toEqual([]);
  });
});
