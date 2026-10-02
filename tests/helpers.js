/* Helpers de test : seed d'état propre, lecture de la DB, dates locales */
const EMPTY_DB = {
  programme: [], history: [], progressions: [],
  weeks: {}, prs: {}, custom: [], active: null
};

function today(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function daysAgo(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* Se place sur l'origine, vide tout, écrit l'état demandé, recharge. */
async function seed(page, db = {}, profile = 'Mouataz'){
  await page.goto('/index.html');
  await page.evaluate(({ db, profile }) => {
    const full = Object.assign({
      programme: [], history: [], progressions: [],
      weeks: {}, prs: {}, custom: [], active: null
    }, db);
    localStorage.clear();
    localStorage.setItem('at_profiles', JSON.stringify(['Mouataz', 'Riad']));
    localStorage.setItem('at_lastUser', profile);
    localStorage.setItem('at_tab', 'programme');
    localStorage.setItem('at_v2_' + profile, JSON.stringify(full));
  }, { db, profile });
  await page.reload();
  await page.waitForSelector('#mainApp:not(.hidden)');
}

/* État réel de la DB du profil courant (+ clés localStorage) */
async function dbState(page){
  return page.evaluate(() => {
    const raw = localStorage.getItem('at_v2_' + (currentUser || ''));
    const d = raw ? JSON.parse(raw) : {};
    return {
      currentUser,
      programme: (d.programme || []).length,
      history: (d.history || []).length,
      prs: Object.keys(d.prs || {}).length,
      prLog: (d.prLog || []).length,
      progressions: (d.progressions || []).length,
      custom: (d.custom || []).length,
      active: !!d.active,
      keys: Object.keys(localStorage).sort()
    };
  });
}

/* Bascule de profil sans passer par le confirm() natif (même effet que switchUser) */
async function switchProfile(page, name){
  await page.evaluate(n => {
    save();
    currentUser = null;
    DB = null;
    localStorage.setItem('at_lastUser', n);
    location.reload();
  }, name);
  await page.waitForSelector('#mainApp:not(.hidden)');
}

module.exports = { EMPTY_DB, today, daysAgo, seed, dbState, switchProfile };
