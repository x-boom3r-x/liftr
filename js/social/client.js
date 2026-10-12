/* ==================================================================
   SOCIAL - client Supabase (créé à la demande, jamais au boot)
   ================================================================== */
import { SOCIAL_CONFIG, SOCIAL_ENABLED } from './config.js';

let _client = null;

export function supabaseLoaded(){
  return typeof window.supabase !== 'undefined' &&
    !!window.supabase && typeof window.supabase.createClient === 'function';
}

/* Client unique. Retourne null tant que le social est coupé. */
export function sb(){
  if (!SOCIAL_ENABLED || !supabaseLoaded()) return null;
  if (!_client){
    _client = window.supabase.createClient(SOCIAL_CONFIG.supabaseUrl, SOCIAL_CONFIG.anonKey, {
      auth: {
        persistSession: true,
        /* JWT d'une heure : sans rafraichissement automatique, les boutons du
           feed echouent silencieusement (401) des que l'onglet vieillit. */
        autoRefreshToken: true,
        /* Sans cela, le retour OAuth (#access_token=...) n'est jamais lu :
           la session Google n'ouvre jamais, l'utilisateur reste deconnecte. */
        detectSessionInUrl: true,
        storageKey: 'liftr-auth'
      }
    });
  }
  return _client;
}

export function sbAuth(){
  const c = sb();
  return c ? c.auth : null;
}

/* ==================================================================
   COLONNES ABSENTES (deploiement en cours)
   Tant que la migration n'est pas appliquee, Postgres refuse une
   colonne inconnue et toute la requete echoue (le feed affiche alors
   « columns.attachments does not exists »). On extrait le nom de la
   colonne fautive du message d'erreur, deux formes sont possibles :
     - PostgREST : "Could not find the 'state' column of 'follows' in the schema cache"
     - Postgres  : "column public.follows.state does not exist"
   ================================================================== */
export function missingColumnField(error){
  const msg = (error && (error.message || '')) + '';
  /* Insert : « column "state" of relation "follows" does not exist »,
     select : « column public.follows.state does not exist »,
     typo   : « columns.attachments does not exists ». On isole le segment
     entre « column » et « does not exist », on retire les guillemets
     (donc aussi ceux de « of relation "follows" ») et on lit le premier
     mot — c'est toujours le nom de colonne. */
  const seg = /columns?([\s\S]{0,160}?)does not exists?/i.exec(msg);
  if (seg){
    const rest = (seg[1] || '').replace(/["']/g, '');
    const w = /^[\s.]*([\w.]+)/.exec(rest);
    if (w && w[1]){
      const name = w[1].replace(/^\.+|\.+$/g, '');
      if (name) return name.indexOf('.') !== -1 ? name.split('.').pop() : name;
    }
  }
  const m = /Could not find the '([\w.]+)' column/i.exec(msg);
  if (!m) return null;
  const name = m[1];
  return name.indexOf('.') !== -1 ? name.split('.').pop() : name;
}

/* `run` recoit la liste des colonnes a selecter et retourne une
   promesse Supabase. Si la selection echoue sur une colonne inconnue,
   on retire cette colonne du select et on reessaie — jusqu'a 3 essais
   (plusieurs colonnes peuvent manquer d'un coup, p. ex. parent_id et
   root_id avant v8). Les noms retires sont dans `res.dropped`. */
export async function withMissingColumn(run, cols){
  let c = String(cols);
  const dropped = [];
  for (let i = 0; i < 3; i++){
    const res = await run(c);
    if (!res || !res.error){
      if (res && dropped.length) res.dropped = dropped.slice();
      return res;
    }
    const bad = missingColumnField(res.error);
    if (!bad){ if (dropped.length) res.dropped = dropped.slice(); return res; }
    const parts = c.split(',').map(s => s.trim());
    const keep = parts.filter(f => f !== bad && f.split('!')[0].split('(')[0].trim() !== bad);
    if (keep.length === parts.length){
      if (dropped.length) res.dropped = dropped.slice();
      return res;
    }
    c = keep.join(',');
    if (dropped.indexOf(bad) < 0) dropped.push(bad);
  }
  const res = await run(c);
  if (res && dropped.length) res.dropped = dropped.slice();
  return res;
}

/* Insert + RETURNING : retire la colonne fautive du payload ET du
   select, jusqu'a convergence (3 essais max). Une passe par erreur —
   Postgres n'en nomme qu'une a la fois. Les noms retires sont
   renvoyes dans `res.dropped` ; `onDrop(champ, payload)` est appele
   juste apres un retrait du payload (le composeur y ajuste `kind`
   quand la carte partagee disparait). */
export async function withMissingFields(run, payload, cols, onDrop){
  let p = Object.assign({}, payload);
  let c = String(cols);
  const dropped = [];
  for (let i = 0; i < 3; i++){
    const res = await run(p, c);
    if (!res || !res.error) { if (res && dropped.length) res.dropped = dropped.slice(); return res; }
    const bad = missingColumnField(res.error);
    if (!bad){ if (dropped.length) res.dropped = dropped.slice(); return res; }
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(p, bad)){
      delete p[bad];
      if (bad === 'parent_id' || bad === 'root_id'){ delete p.parent_id; delete p.root_id; }
      if (typeof onDrop === 'function') onDrop(bad, p);
      changed = true;
    }
    const parts = c.split(',').map(s => s.trim());
    const keep = parts.filter(f => f !== bad && f.split('!')[0].split('(')[0].trim() !== bad);
    if (keep.length < parts.length){ c = keep.join(','); changed = true; }
    if (!changed){ if (dropped.length) res.dropped = dropped.slice(); return res; }
    if (dropped.indexOf(bad) < 0) dropped.push(bad);
  }
  const res = await run(p, c);
  if (res && dropped.length) res.dropped = dropped.slice();
  return res;
}

/* Lignes de follows : n'accepte que les abonnements acceptes. Avant la
   migration v8 la colonne `state` n'existe pas (withMissingColumn la
   retire du select) — les lignes sont alors toutes acceptees, comme
   historiquement. */
export function acceptedFollows(rows){
  return (rows || []).filter(r => r && (r.state === undefined || r.state === 'accepted'));
}
