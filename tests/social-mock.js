/* Fake backend Supabase pour les tests sociaux (partagé par social-v3). */
const { seed } = require('./helpers');

const MOCK_CONFIG = { supabaseUrl: 'https://demo-project.supabase.co', anonKey: 'anon-key-for-tests' };
const ME = { id: '11111111-1111-4111-8111-111111111111', user_metadata: { name: 'Mouataz' } };
const ANA = '22222222-2222-4222-8222-222222222222';

const ME_P = {
  id: ME.id, username: 'mouataz', display_name: 'Mouataz',
  avatar_url: null, bio: 'Push · Pull · Legs', created_at: new Date().toISOString()
};
const ANA_P = {
  id: ANA, username: 'ana', display_name: 'Ana',
  avatar_url: null, bio: 'Push day', created_at: new Date(Date.now() - 86400000).toISOString()
};

function withSocial(page){
  return page.addInitScript(cfg => { window.LIFTR_SOCIAL_CONFIG = cfg; }, MOCK_CONFIG);
}

async function signedIn(page, user){
  await page.evaluate(u => Promise.resolve(window.restoreSession()).then(() => {
    window.socialUser = u;
    window.updateSocialGate();
  }), user || ME);
}

function consoleWatch(page){
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  return errs;
}

async function openFeed(page){
  await page.locator('#tabFeedBtn').click();
  await page.locator('#tab-feed').waitFor({ state: 'visible' });
}

function post(i, authorId, over){
  return Object.assign({
    id: 'post-' + i,
    kind: 'text',
    body: 'Session ' + i,
    image_path: null,
    thumb_path: null,
    meta: {},
    created_at: new Date(Date.now() - i * 3600000).toISOString(),
    deleted_at: null,
    author_id: authorId || ME.id,
    author: authorId === ANA
      ? { id: ANA, username: 'ana', display_name: 'Ana', avatar_url: null }
      : { id: ME.id, username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
  }, over || {});
}

function story(i, authorId, over){
  return Object.assign({
    id: 'story-' + i,
    author_id: authorId || ME.id,
    body: 'Story ' + i,
    image_path: null,
    created_at: new Date(Date.now() - i * 60000).toISOString(),
    expires_at: new Date(Date.now() + 86400000 - i * 60000).toISOString(),
    author: authorId === ANA
      ? { id: ANA, username: 'ana', display_name: 'Ana', avatar_url: null }
      : { id: ME.id, username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
  }, over || {});
}

function mockApi(page, opts){
    const st = Object.assign({
      posts: [post(0), post(1)],
      people: [ANA_P, ME_P],
      comments: [],
      follows: [],
      likes: [],
      votes: [],
      reposts: [],
      saves: [],
      convos: [],
      msgs: [],
      stories: [],
      story_views: [],
      notes: [],
      seq: 0
    }, opts || {});

  const calls = [];
  const json = (route, body, status) => route.fulfill({
    status: status || 200, contentType: 'application/json', body: JSON.stringify(body)
  });
  const noContent = route => route.fulfill({ status: 204, body: '' });

  page.route('**/*.supabase.co/**', async route => {
    const req = route.request();
    const call = { url: req.url(), method: req.method().toUpperCase(), body: req.postData() };
    calls.push(call);

    /* storage : on ne fabrique pas d'objets, on enregistre juste les écritures */
    if (!call.url.includes('/rest/v1/')){
      if (call.url.includes('/storage/v1/') && call.method !== 'GET')
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }

    const u = decodeURIComponent(call.url);
    const tm = u.match(/\/rest\/v1\/([a-z_]+)(\?|$|\/)/);
    const table = tm ? tm[1] : null;
    const method = call.method;
    const head = method === 'HEAD';
    const range = total => route.fulfill({
      status: 200,
      headers: { 'content-range': `0-${Math.max(0, total - 1)}/${total}` },
      body: ''
    });

    /* helper : eq / neq / in / gt / is.null sur une colonne */
    const eq = (col) => { const m = u.match(new RegExp(col + '=eq\\.([^&]+)')); return m ? m[1] : null; };
    const gt = (col) => { const m = u.match(new RegExp(col + '=gt\\.([^&]+)')); return m ? m[1] : null; };
    const isIn = (col) => {
      const m = u.match(new RegExp(col + '=in\\.\\(([^)]*)\\)'));
      return m ? m[1].split(',').filter(Boolean) : null;
    };
    const applyOrder = (rows) => {
      const m = u.match(/order=([a-z_]+)\.(asc|desc)/);
      if (!m) return rows;
      const k = m[1], dir = m[2] === 'desc' ? -1 : 1;
      return rows.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
    };
    const parseBody = () => { try { return JSON.parse(call.body || '{}'); } catch(e){ return {}; } };

    /* ---------- posts ---------- */
    if (table === 'posts'){
      let rows = st.posts.filter(p => !p.deleted_at);
      const ids = isIn('author_id');
      if (ids) rows = rows.filter(p => ids.includes(p.author_id));
      const a = eq('author_id');
      if (a) rows = rows.filter(p => p.author_id === a);
      const pids = isIn('id');
      if (pids) rows = rows.filter(p => pids.includes(p.id));
      rows = applyOrder(rows);
      if (head) return range(rows.length);
      if (method === 'DELETE'){
        const id = eq('id');
        st.posts = st.posts.filter(p => p.id !== id);
        return noContent(route);
      }
      if (method === 'POST'){
        const body = parseBody();
        const rec = Object.assign({ id: 'post-new' + (++st.seq), created_at: new Date().toISOString(),
          deleted_at: null, meta: {}, author: {
            id: body.author_id || ME.id, username: 'mouataz',
            display_name: 'Mouataz', avatar_url: null } }, body);
        st.posts.unshift(rec);
        return json(route, [rec], 201);
      }
      return json(route, rows.slice(0, 40));
    }

    /* ---------- profiles ---------- */
    if (table === 'profiles'){
      if (method === 'PATCH'){
        const id = eq('id');
        const body = parseBody();
        st.people.forEach(p => { if (p.id === id) Object.assign(p, body); });
        return json(route, [], 204);
      }
      let rows = st.people.slice();
      const a = eq('id'); if (a) rows = rows.filter(p => p.id === a);
      const ids = isIn('id'); if (ids) rows = rows.filter(p => ids.includes(p.id));
      const orm = u.match(/or=\(([^)]*)\)/);
      if (orm){
        const t = ((orm[1].match(/ilike\.%([^,%]*)%/) || [,''])[1]).toLowerCase();
        rows = rows.filter(p => (p.username || '').toLowerCase().includes(t) ||
                                (p.display_name || '').toLowerCase().includes(t));
      }
      return json(route, rows);
    }

    /* ---------- feed_counts ---------- */
    if (table === 'feed_counts'){
      const ids = isIn('post_id') || [];
      return json(route, ids.map(id => ({
        post_id: id,
        comment_count: st.comments.filter(c => c.post_id === id).length,
        like_count: st.likes.filter(l => l.post_id === id).length
      })));
    }

    /* ---------- likes ---------- */
    if (table === 'likes'){
      if (method === 'POST'){ st.likes.push(parseBody()); return json(route, [], 201); }
      if (method === 'DELETE'){
        const id = eq('post_id');
        st.likes = st.likes.filter(l => l.post_id !== id);
        return noContent(route);
      }
      let rows = st.likes.slice();
      const ids = isIn('post_id'); if (ids) rows = rows.filter(l => ids.includes(l.post_id));
      const uq = eq('user_id'); if (uq) rows = rows.filter(l => l.user_id === uq);
      return json(route, rows);
    }

    /* ---------- post_votes / post_reposts / post_saves (G) ---------- */
    const ownRows = (arr, key) => {
      /* POST = upsert sur (user_id, post_id) ; DELETE filtre post_id + user_id */
      if (method === 'POST'){
        const body = parseBody();
        const rest = arr.filter(r => !(r.user_id === body.user_id && r.post_id === body.post_id));
        rest.push(body);
        return rest;
      }
      if (method === 'DELETE'){
        const pid = eq('post_id'), uid2 = eq('user_id');
        return arr.filter(r =>
          !(r.post_id === pid && (uid2 === null || r.user_id === uid2)));
      }
      return null;
    };
    if (table === 'post_votes'){
      const next = ownRows(st.votes, 'vote');
      if (next){ st.votes = next; return method === 'POST' ? json(route, [], 201) : noContent(route); }
      let rows = st.votes.slice();
      const ids = isIn('post_id'); if (ids) rows = rows.filter(r => ids.includes(r.post_id));
      const uq = eq('user_id'); if (uq) rows = rows.filter(r => r.user_id === uq);
      return json(route, rows);
    }
    if (table === 'post_reposts'){
      const next = ownRows(st.reposts, 'repost');
      if (next){ st.reposts = next; return method === 'POST' ? json(route, [], 201) : noContent(route); }
      let rows = st.reposts.slice();
      const ids = isIn('post_id'); if (ids) rows = rows.filter(r => ids.includes(r.post_id));
      const uid3 = isIn('user_id'); if (uid3) rows = rows.filter(r => uid3.includes(r.user_id));
      const uq = eq('user_id'); if (uq) rows = rows.filter(r => r.user_id === uq);
      if (u.match(/by:profiles!/)){
        rows = rows.map(r => {
          const person = st.people.filter(p => p.id === r.user_id)[0] || {};
          return Object.assign({}, r, {
            by: { id: r.user_id, username: person.username || null,
              display_name: person.display_name || null, avatar_url: person.avatar_url || null }
          });
        });
      }
      return json(route, applyOrder(rows));
    }
    if (table === 'post_saves'){
      const next = ownRows(st.saves, 'save');
      if (next){ st.saves = next; return method === 'POST' ? json(route, [], 201) : noContent(route); }
      let rows = st.saves.slice();
      const ids = isIn('post_id'); if (ids) rows = rows.filter(r => ids.includes(r.post_id));
      const uq = eq('user_id'); if (uq) rows = rows.filter(r => r.user_id === uq);
      return json(route, applyOrder(rows));
    }

    /* ---------- comments ---------- */
    if (table === 'comments'){
      if (method === 'POST'){
        const body = parseBody();
        const rec = Object.assign({
          id: 'c' + (++st.seq),
          created_at: new Date().toISOString(),
          deleted_at: null,
          author: { id: ME.id, username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
        }, body);
        st.comments.push(rec);
        return json(route, [rec], 201);
      }
      if (method === 'DELETE'){
        const id = eq('id');
        st.comments = st.comments.filter(c => c.id !== id);
        return noContent(route);
      }
      const pid = eq('post_id');
      const rows = st.comments.filter(c => c.deleted_at ? false : (!pid || c.post_id === pid));
      return json(route, applyOrder(rows));
    }

    /* ---------- follows ---------- */
    if (table === 'follows'){
      if (method === 'POST'){ st.follows.push(parseBody()); return json(route, [], 201); }
      if (method === 'DELETE'){
        const id = eq('followee_id');
        st.follows = st.follows.filter(x => x.followee_id !== id);
        return noContent(route);
      }
      let rows = st.follows.slice();
      const fe = eq('followee_id'); if (fe) rows = rows.filter(x => x.followee_id === fe);
      const fi = eq('follower_id'); if (fi) rows = rows.filter(x => x.follower_id === fi);
      if (head) return range(rows.length);
      return json(route, rows);
    }

    /* ---------- conversations ---------- */
    if (table === 'conversations'){
      if (method === 'POST'){
        const body = parseBody();
        const rec = Object.assign({
          id: 'conv-' + (++st.seq),
          last_message_at: new Date().toISOString(),
          last_preview: null, last_sender_id: null
        }, body);
        st.convos.push(rec);
        return json(route, [rec], 201);
      }
      let rows = st.convos.slice();
      const ua = eq('user_a'); if (ua) rows = rows.filter(x => x.user_a === ua);
      const ub = eq('user_b'); if (ub) rows = rows.filter(x => x.user_b === ub);
      rows = applyOrder(rows);
      return json(route, rows);
    }

    /* ---------- messages ---------- */
    if (table === 'messages'){
      if (method === 'POST'){
        const body = parseBody();
        const rec = Object.assign({
          id: 'msg-' + (++st.seq),
          created_at: new Date().toISOString(),
          read_at: null
        }, body);
        st.msgs.push(rec);
        const cv = st.convos.find(x => x.id === rec.conversation_id);
        if (cv){ cv.last_message_at = rec.created_at; cv.last_preview = rec.body; cv.last_sender_id = rec.sender_id; }
        return json(route, [rec], 201);
      }
      let rows = st.msgs.slice();
      const cid = eq('conversation_id'); if (cid) rows = rows.filter(x => x.conversation_id === cid);
      const cids = isIn('conversation_id'); if (cids) rows = rows.filter(x => cids.includes(x.conversation_id));
      if (/read_at=is\.null/.test(u)) rows = rows.filter(x => x.read_at === null);
      if (head) return range(rows.length);
      return json(route, applyOrder(rows));
    }

    /* ---------- stories ---------- */
    if (table === 'stories'){
      if (method === 'POST'){
        const body = parseBody();
        const rec = Object.assign({
          id: 'story-new' + (++st.seq),
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          author: { id: body.author_id || ME.id, username: 'mouataz',
                    display_name: 'Mouataz', avatar_url: null }
        }, body);
        st.stories.push(rec);
        return json(route, [rec], 201);
      }
      if (method === 'DELETE'){
        const id = eq('id');
        st.stories = st.stories.filter(s => s.id !== id);
        return noContent(route);
      }
      let rows = st.stories.slice();
      const a = eq('author_id'); if (a) rows = rows.filter(s => s.author_id === a);
      const ids = isIn('author_id'); if (ids) rows = rows.filter(s => ids.includes(s.author_id));
      const ex = gt('expires_at'); if (ex) rows = rows.filter(s => s.expires_at > ex);
      rows = applyOrder(rows);
      if (head) return range(rows.length);
      return json(route, rows);
    }

    /* ---------- story_views (upsert) ---------- */
    if (table === 'story_views'){
      if (method === 'POST'){
        const body = parseBody();
        const found = st.story_views.find(v => v.story_id === body.story_id && v.viewer_id === body.viewer_id);
        if (found) found.seen_at = new Date().toISOString();
        else st.story_views.push(Object.assign({ seen_at: new Date().toISOString() }, body));
        return json(route, [], 201);
      }
      let rows = st.story_views.slice();
      const v = eq('viewer_id'); if (v) rows = rows.filter(x => x.viewer_id === v);
      const sids = isIn('story_id'); if (sids) rows = rows.filter(x => sids.includes(x.story_id));
      return json(route, rows);
    }

    /* ---------- notes ---------- */
    if (table === 'notes'){
      /* La vraie table (migration v3) n'a que ces colonnes — on rejette
         comme PostgREST (PGRST204) pour attraper toute incohérence. */
      const NOTE_COLS = ['id', 'author_id', 'body', 'created_at', 'expires_at'];
      const pgrst204 = (col) => json(route, {
        code: 'PGRST204',
        message: "Could not find the '" + col + "' column of 'notes' in the schema cache",
        details: null, hints: null
      }, 400);
      if (method === 'GET' || head){
        const sm = u.match(/select=([^&]+)/);
        if (sm){
          /* on avale les parenthèses (jointures) avant de splitter */
          const flat = decodeURIComponent(sm[1]).replace(/\([^)]*\)/g, '');
          if (flat.split(',').some(c => {
            const t = c.trim();
            return t && !NOTE_COLS.includes(t) && !t.startsWith('author:');
          })) return pgrst204('updated_at');
        }
      }
      if (method === 'POST'){
        const body = parseBody();
        const extra = Object.keys(body).filter(k => !NOTE_COLS.includes(k));
        if (extra.length) return pgrst204(extra[0]);
        const found = st.notes.find(n => n.author_id === body.author_id);
        if (found) Object.assign(found, body, { updated_at: new Date().toISOString() });
        else st.notes.push(Object.assign({
          id: 'note-' + (++st.seq),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString()
        }, body));
        return json(route, [], 201);
      }
      if (method === 'PATCH'){
        const body = parseBody();
        const a = eq('author_id');
        st.notes.forEach(n => { if (!a || n.author_id === a) Object.assign(n, body); });
        return json(route, [], 204);
      }
      if (method === 'DELETE'){
        const id = eq('id');
        st.notes = st.notes.filter(n => n.id !== id);
        return noContent(route);
      }
      let rows = st.notes.slice();
      const ids = isIn('author_id'); if (ids) rows = rows.filter(n => ids.includes(n.author_id));
      const a = eq('author_id'); if (a) rows = rows.filter(n => n.author_id === a);
      const ex = gt('expires_at'); if (ex) rows = rows.filter(n => n.expires_at > ex);
      rows = applyOrder(rows);
      if (head) return range(rows.length);
      return json(route, rows);
    }

    return json(route, []);
  });

  return { st, calls };
}

module.exports = { MOCK_CONFIG, ME, ANA, ME_P, ANA_P, withSocial, signedIn,
  consoleWatch, openFeed, post, story, mockApi, seed };
