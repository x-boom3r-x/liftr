import { sb } from './client.js';

/* ==================================================================
   SOCIAL - compte privé / public

   Deux niveaux, détectés automatiquement :
   1. « colonne » : si la migration v4 (`profiles.is_private`) est
      appliquée, le drapeau vit en base et les policies RLS cachent
      réellement les contenus des comptes privés.
   2. « bio »     : sinon, un marqueur invisible est conservé dans le
      bio (champ texte public déjà lisible par tout le monde) et le
      filtrage se fait côté client. Le rendu, le bouton et les
      règles de visibilité sont identiques dans les deux cas.
   ================================================================== */

const MARK = '\u2063private\u2063';   /* séparateur invisible (U+2063) */

let mode = null;         /* 'column' | 'token' */
let probing = null;

function meId(){ return (window.socialUser || {}).id || null; }

/* ----------------------------- mode ------------------------------ */
export async function privacyMode(){
  if (mode) return mode;
  if (probing) return probing;
  const c = sb();
  if (!c) return (mode = 'token');
  probing = (async () => {
    try {
      const { error } = await c.from('profiles').select('is_private').limit(1);
      mode = error ? 'token' : 'column';
    } catch(e){
      mode = 'token';
    } finally {
      probing = null;
    }
    return mode;
  })();
  return probing;
}

/* Chaîne de select à ajouter aux requêtes `profiles` (colonnes connues). */
export function privacySelect(){
  return mode === 'column' ? ',is_private' : '';
}

/* --------------------------- lecture ----------------------------- */
export function isPrivateProfile(p){
  if (!p) return false;
  if (mode === 'column') return p.is_private === true || p.is_private === 't';
  return String(p.bio || '').indexOf(MARK) >= 0;
}

export function stripPrivacy(bio){
  const s = String(bio == null ? '' : bio);
  const i = s.indexOf(MARK);
  return (i < 0 ? s : s.slice(0, i)).trim();
}

export function withPrivacy(bio, isPrivate){
  const base = stripPrivacy(bio);
  return isPrivate ? (base + MARK) : base;
}

/* ---------------------------- écriture --------------------------- */
export async function writePrivacy(isPrivate){
  const c = sb();
  const me = meId();
  if (!c || !me) return false;
  const on = !!isPrivate;

  if (mode === null) await privacyMode();

  if (mode === 'column'){
    const { error } = await c.from('profiles').update({ is_private: on }).eq('id', me);
    if (error) throw new Error(error.message || 'Could not update your privacy.');
    return true;
  }

  const { data, error } = await c.from('profiles').select('bio').eq('id', me).limit(1);
  if (error) throw new Error(error.message || 'Could not update your privacy.');
  const row = Array.isArray(data) ? data[0] : data;
  const next = withPrivacy((row && row.bio) || '', on);
  const { error: up } = await c.from('profiles').update({ bio: next }).eq('id', me);
  if (up) throw new Error(up.message || 'Could not update your privacy.');
  return true;
}

/* ------------------- filtrage du fil (client) --------------------- */
export async function filterPrivatePosts(rows){
  if (!Array.isArray(rows) || !rows.length) return rows;
  const c = sb();
  const me = meId();
  if (!c || !me) return rows;

  const others = [];
  rows.forEach(r => {
    if (r.author_id && r.author_id !== me && others.indexOf(r.author_id) < 0) others.push(r.author_id);
  });
  if (!others.length) return rows;

  try {
    await privacyMode();
    const [flags, links] = await Promise.all([
      c.from('profiles').select('id,bio' + privacySelect()).in('id', others),
      c.from('follows').select('followee_id').eq('follower_id', me)
    ]);
    const followed = new Set((links.data || []).map(r => r.followee_id));
    const hidden = new Set((flags.data || [])
      .filter(isPrivateProfile)
      .filter(p => !followed.has(p.id))
      .map(p => p.id));
    if (!hidden.size) return rows;
    return rows.filter(r => !hidden.has(r.author_id));
  } catch(e){
    return rows;
  }
}

/* Visible pour l'écran « profil ». */
export function canSeePosts(profile){
  if (!profile) return false;
  const me = meId();
  if (profile.id === me) return true;
  if (!isPrivateProfile(profile)) return true;
  if (typeof window.isFollowed === 'function') return !!window.isFollowed(profile.id);
  return false;
}

export function resetPrivacy(){
  mode = null;
  probing = null;
}
