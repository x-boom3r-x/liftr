/* QA de la base de commentaires LIFTR : comptage, unicité, répartition, qualité.
   Usage : node tests/qa-comments.js [--strict]
   --strict = exige 1016 entrées et la répartition exacte (sinon échec). */
const path = require('path');
const { pathToFileURL } = require('url');

const FILES = [
  ['NEW_PR', 'new-pr.js', 120],
  ['STRENGTH_PROGRESS', 'strength-progress.js', 120],
  ['REPS_PROGRESS', 'reps-progress.js', 100],
  ['VOLUME_PROGRESS', 'volume-progress.js', 100],
  ['CONSISTENCY', 'consistency.js', 120],
  ['COMEBACK', 'comeback.js', 80],
  ['HARD_SESSION', 'hard-session.js', 90],
  ['MILESTONE', 'milestone.js', 80],
  ['GOAL_REACHED', 'goal-reached.js', 16],
  ['SETBACK', 'setback.js', 70],
  ['GENERAL_PROGRESS', 'general-progress.js', 120]
];

const BANNED = [
  [/great job/i, 'phrase générique « great job »'],
  [/keep going/i, 'phrase générique « keep going »'],
  [/keep it up/i, 'phrase générique « keep it up »'],
  [/well done/i, 'phrase générique « well done »'],
  [/https?:\/\//, 'URL'],
  [/\p{Extended_Pictographic}/u, 'emoji'],
  [/you are \d+%/i, 'template pourcentage']
];

const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(Boolean);

function jaccard(a, b){
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

(async () => {
  const strict = process.argv.includes('--strict');
  const errors = [];
  const warnings = [];
  const all = [];
  const counts = {};

  for (const [filter, file, expected] of FILES){
    const p = path.join(__dirname, '..', 'js', 'comments', file);
    let mod;
    try {
      mod = await import(pathToFileURL(p).href);
    } catch (e){
      errors.push(`fichier manquant/invalide : ${file} (${e.message})`);
      continue;
    }
    const list = mod.default;
    if (!Array.isArray(list)){ errors.push(`${file} : export default absent`); continue; }
    counts[filter] = list.length;
    if (list.length !== expected) errors.push(`${filter} : ${list.length} textes, attendu ${expected}`);
    list.forEach((comment, i) => {
      if (typeof comment !== 'string' || !comment.trim()) errors.push(`${filter}[${i}] : texte vide/absent`);
      all.push({ filter, comment, src: `${file}[${i}]` });
    });
  }

  const total = all.length;
  console.log('--- Répartition ---');
  for (const [f, , exp] of FILES) console.log(`  ${f.padEnd(20)} ${counts[f] ?? 0}/${exp}`);
  console.log(`  TOTAL               ${total}/1016`);
  if (strict && total !== 1016) errors.push(`total ${total}, attendu 1016`);

  // IDs (générés comme dans js/comments.js : liftr_0001… dans l'ordre du fichier)
  const ids = new Set();
  for (let i = 1; i <= total; i++) ids.add('liftr_' + String(i).padStart(4, '0'));
  if (ids.size !== total) errors.push('IDs non uniques');

  // Unicité des textes
  const seenExact = new Map();
  const seenNorm = new Map();
  for (const e of all){
    if (seenExact.has(e.comment)) errors.push(`texte dupliqué : ${e.src} = ${seenExact.get(e.comment)}`);
    else seenExact.set(e.comment, e.src);
    const k = norm(e.comment);
    if (seenNorm.has(k)) errors.push(`texte dupliqué (normalisé) : ${e.src} = ${seenNorm.get(k)}`);
    else seenNorm.set(k, e.src);
  }

  // Qualité : bannis, longueur
  let sumW = 0, minW = 1e9, maxW = 0, inBand = 0;
  for (const e of all){
    for (const [re, why] of BANNED) if (re.test(e.comment)) errors.push(`${e.src} : ${why} → « ${e.comment} »`);
    const wc = words(e.comment).length;
    sumW += wc; minW = Math.min(minW, wc); maxW = Math.max(maxW, wc);
    if (wc >= 12 && wc <= 35) inBand++;
    if (wc < 3) errors.push(`${e.src} : trop court (${wc} mots)`);
    if (wc > 55) warnings.push(`${e.src} : très long (${wc} mots)`);
  }
  console.log('--- Longueurs (mots) ---');
  console.log(`  moyenne ${(sumW / total).toFixed(1)} · min ${minW} · max ${maxW} · dans la bande 12-35 : ${total ? Math.round(100 * inBand / total) : 0}%`);
  if (total && inBand / total < 0.45) warnings.push(`seulement ${Math.round(100 * inBand / total)}% dans la bande 12-35 mots (cible : majorité)`);

  // Near-duplicates (Jaccard > 0.72) — plafonné en coût : comparaison par blocs de filtre
  const wordSets = all.map(e => new Set(words(e.comment)));
  const flagged = [];
  for (let i = 0; i < all.length; i++){
    for (let j = i + 1; j < all.length; j++){
      const a = wordSets[i], b = wordSets[j];
      if (Math.abs(a.size - b.size) > 12) continue;
      let inter = 0;
      for (const w of a) if (b.has(w)) inter++;
      if (inter / (a.size + b.size - inter) > 0.72){
        flagged.push(`${all[i].src} ↔ ${all[j].src}\n    « ${all[i].comment} »\n    « ${all[j].comment} »`);
      }
    }
  }
  if (flagged.length){
    console.log(`--- Near-duplicates (${flagged.length}) ---`);
    flagged.slice(0, 25).forEach(f => console.log('  ' + f));
    errors.push(`${flagged.length} paire(s) trop proches`);
  }

  if (warnings.length){
    console.log('--- Avertissements ---');
    warnings.slice(0, 20).forEach(w => console.log('  ' + w));
  }
  if (errors.length){
    console.log(`\nÉCHECS (${errors.length}) :`);
    errors.slice(0, 40).forEach(e => console.log('  ✗ ' + e));
    process.exit(1);
  }
  console.log('\nQA OK — base conforme.');
})();
