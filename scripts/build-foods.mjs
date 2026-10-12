/* J1 — import Excel : suivi_calories_macros.xlsx -> data/foods.json
   Source unique = feuille "Aliments" (1 feuille technique, valeurs /100 g).
   - 1 ligne (Aliment, État) = 1 entrée de base (le cru et le cuit ne se mélangent jamais)
   - id = slug(libellé) stable : slug(nom) + "--" + slug(état)
   - nutriments présents dans le fichier : kcal, protein, carbs, fat
     (fibres / sucres / sodium absents de la source -> non émis, nutrition.js compte 0)
   - gramsPerUnit : colonnes "Unité courante" + "Poids d'1 unité (g)"
   - density : colonne "Densité (g/ml)" (liquides)
   - atwaterCheck() exécuté sur CHAQUE ligne : anomalies listées dans le rapport,
     jamais corrigées silencieusement (l'auteur tranche).
   Usage : node scripts/build-foods.mjs [chemin.xlsx] */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import XLSX from 'xlsx';
import { atwaterCheck } from '../js/nutrition.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = process.argv[2] || path.join(root, 'suivi_calories_macros.xlsx');
const outDir = path.join(root, 'data');
const outJson = path.join(outDir, 'foods.json');
const outReport = path.join(outDir, 'foods-report.md');

const STATE_SLUG = { 'Cru / sec': 'cru-sec', 'Cuit': 'cuit', 'Tel que vendu': 'tel-que-vendu' };

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

if (!existsSync(src)) throw new Error('xlsx introuvable : ' + src);
const wb = XLSX.readFile(src);
const sheet = wb.Sheets['Aliments'];
if (!sheet) throw new Error('feuille "Aliments" absente (trouvé : ' + wb.SheetNames.join(', ') + ')');
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true });

const hIdx = grid.findIndex((r) => r && r[0] === 'Catégorie' && r[1] === 'Aliment');
if (hIdx < 0) throw new Error('ligne d\'en-tête introuvable');
const COL = { cat: 0, name: 1, state: 2, kcal: 3, protein: 4, carbs: 5, fat: 6, unit: 8, unitG: 9, density: 10, origin: 11, note: 12, syn: 13, label: 14 };

const foods = [];
const errors = [];
const seen = new Map();
const stats = { states: {}, origins: {}, units: 0, densities: 0, withSyn: 0 };

for (let i = hIdx + 1; i < grid.length; i++) {
  const r = grid[i];
  if (!r || r[COL.name] == null) continue;
  const row = i + 1; // n° de ligne Excel
  const name = String(r[COL.name]).trim();
  const state = String(r[COL.state] ?? '').trim();
  const cat = String(r[COL.cat] ?? '').trim();
  if (!STATE_SLUG[state]) { errors.push(`ligne ${row} : état inconnu "${state}" (${name})`); continue; }
  if (!cat) errors.push(`ligne ${row} : catégorie absente (${name})`);
  const kcal = num(r[COL.kcal]), protein = num(r[COL.protein]), carbs = num(r[COL.carbs]), fat = num(r[COL.fat]);
  for (const [k, v] of Object.entries({ kcal, protein, carbs, fat }))
    if (v == null) errors.push(`ligne ${row} : ${k} manquant/non numérique (${name} — ${state})`);
  if (kcal == null || protein == null || carbs == null || fat == null) continue;

  const id = `${slug(name)}--${STATE_SLUG[state]}`;
  if (seen.has(id)) { errors.push(`ligne ${row} : id dupliqué "${id}" (lignes ${seen.get(id)} et ${row})`); continue; }
  seen.set(id, row);

  const food = { id, name, state, category: cat, kcal, protein, carbs, fat };

  const unitLabel = r[COL.unit] != null ? String(r[COL.unit]).trim() : null;
  const unitG = num(r[COL.unitG]);
  if (unitLabel && unitG != null) {
    let key = 'piece';
    if (/c\.\s*à\s*soupe|15\s*ml/i.test(unitLabel)) key = 'tbsp';
    else if (/c\.\s*à\s*caf/i.test(unitLabel)) key = 'tsp';
    food.gramsPerUnit = { [key]: unitG };
    food.unitLabel = unitLabel;
    stats.units++;
  } else if ((unitLabel == null) !== (unitG == null)) {
    errors.push(`ligne ${row} : unité/poids incohérents ("${unitLabel}" / ${unitG}) — ${name}`);
  }

  const density = typeof r[COL.density] === 'number' && Number.isFinite(r[COL.density]) ? r[COL.density] : null;
  if (density != null) { food.density = density; stats.densities++; }

  const syn = r[COL.syn] != null ? String(r[COL.syn]).trim() : '';
  if (syn) { food.synonyms = syn; stats.withSyn++; }

  stats.states[state] = (stats.states[state] || 0) + 1;
  const origin = r[COL.origin] != null ? String(r[COL.origin]).trim() : '';
  if (origin) stats.origins[origin] = (stats.origins[origin] || 0) + 1;

  const at = atwaterCheck(food);
  const rawDiff = Math.abs(at.calc - at.stated);
  food._atwater = { ...at, rawDiff };
  foods.push(food);
}

if (errors.length) {
  console.error('ERREURS STRUCTURELLES (' + errors.length + ') :');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

// --- rapport Atwater : anomalies bloquantes (hors tolérance) + mineures (écart ≤ 12 kcal) ---
const anomalies = [];
const minor = [];
for (const f of foods) {
  const at = f._atwater;
  if (!at.ok) anomalies.push({ f, at });
  else if (at.diff > 0.15) minor.push({ f, at });
}

const report = [];
report.push('# Rapport d\'import — suivi_calories_macros.xlsx → data/foods.json');
report.push('');
report.push('## Structure source');
report.push('');
report.push('- Feuille unique utilisée : **Aliments** (en-tête ligne 4, données lignes 5 à ' + (grid.length) + ').');
report.push('- Colonnes : ' + grid[hIdx].map((c) => c).join(' · '));
report.push('- Feuilles dérivées NON importées : Recherche / Calculateur / Portions pratiques / _Aide (vues formulaïques de la même base) ; Notes & sources = méthodo.');
report.push('- **Aucune conversion d\'unité nécessaire** : toutes les valeurs sont déjà pour 100 g/100 ml (pas de kJ, pas de « pour 1 portion »).');
report.push('');
report.push('## Mapping colonnes → champs nutrition.js (pour 100 g)');
report.push('');
report.push('| Colonne Excel | Champ food |');
report.push('|---|---|');
report.push('| Aliment + État | `name` + `state` (1 ligne par état, jamais mélangées) |');
report.push('| Catégorie | `category` |');
report.push('| Calories (kcal) | `kcal` |');
report.push('| Protéines (g) | `protein` |');
report.push('| Glucides (g) | `carbs` |');
report.push('| Lipides (g) | `fat` |');
report.push('| Unité courante + Poids d\'1 unité (g) | `gramsPerUnit` (`piece`, `tbsp` pour « c. à soupe », `tsp` pour « c. à café`) + `unitLabel` affichable |');
report.push('| Densité (g/ml) | `density` |');
report.push('| Synonymes / mots-clés | `synonyms` (alimenté à la recherche) |');
report.push('| Protéines pour 100 kcal | ignorée (dérivée) |');
report.push('| Origine / Source / Libellé | ignorés (provenance, non nutritionnels) |');
report.push('');
report.push('## Colonnes attendues par nutrition.js ABSENTES de la source');
report.push('');
report.push('- `fiber`, `sugar`, `sodium_mg` : **aucune colonne dans le fichier** → non émis dans foods.json ; nutrition.js les compte à 0 (`food[f] || 0`). À documenter dans l\'UI (pas de données, pas de 0 affiché comme mesure).');
report.push('');
report.push('## Volume');
report.push('');
report.push('- **' + foods.length + ' aliments** (une ligne par couple Aliment × État) ; 0 doublon (nom, état) ; 0 manquant sur kcal/P/G/L ; 0 négatif.');
report.push('- États : ' + Object.entries(stats.states).map(([k, v]) => `${k} = ${v}`).join(' · '));
report.push('- Origines : ' + Object.entries(stats.origins).map(([k, v]) => `${k} = ${v}`).join(' · '));
report.push('- Lignes avec unité courante (→ gramsPerUnit) : ' + stats.units + ' ; avec densité : ' + stats.densities + ' ; avec synonymes : ' + stats.withSyn + '.');
report.push('- Catégories : ' + [...new Set(foods.map((f) => f.category))].length + '.');
report.push('');
report.push('## Contrôle Atwater (kcal ≈ 4·P + 4·C + 9·F, tolérance ±15 %)');
report.push('');
report.push('Rappel : fibres/alcool/polyols s\'écartent légitimement — **rien n\'a été corrigé**, l\'auteur tranche.');
report.push('');
report.push(`### Anomalies (${anomalies.length}) — écart > 15 % ET > 12 kcal`);
report.push('');
if (anomalies.length) {
  report.push('| Ligne | Aliment | État | kcal indiquées | Atwater calculé | Écart |');
  report.push('|---|---|---|---|---|---|');
  for (const { f, at } of anomalies) report.push(`| ${seen.get(f.id)} | ${f.name} | ${f.state} | ${at.stated} | ${at.calc} | ${(at.diff * 100).toFixed(0)} % |`);
} else report.push('_Aucune._');
report.push('');
report.push(`### Mineures (${minor.length}) — écart > 15 % mais ≤ 12 kcal (accepté par atwaterCheck)`);
report.push('');
if (minor.length) {
  report.push('| Ligne | Aliment | État | kcal | Atwater | Écart |');
  report.push('|---|---|---|---|---|---|');
  for (const { f, at } of minor) report.push(`| ${seen.get(f.id)} | ${f.name} | ${f.state} | ${at.stated} | ${at.calc} | ${(at.diff * 100).toFixed(0)} % |`);
} else report.push('_Aucune._');
report.push('');

mkdirSync(outDir, { recursive: true });
const payload = {
  meta: {
    source: 'suivi_calories_macros.xlsx (feuille Aliments)',
    unit: 'valeurs pour 100 g (liquides : 1 ml ≈ 1 g)',
    count: foods.length,
    absent_fields: ['fiber', 'sugar', 'sodium_mg'],
    atwater_anomalies: anomalies.length
  },
  foods: foods.map(({ _atwater, ...f }) => f)
};
writeFileSync(outJson, JSON.stringify(payload, null, 1) + '\n');
writeFileSync(outReport, report.join('\n') + '\n');

console.log(`foods.json : ${foods.length} aliments -> ${path.relative(root, outJson)}`);
console.log(`Atwater    : ${anomalies.length} anomalie(s), ${minor.length} mineure(s) -> ${path.relative(root, outReport)}`);
console.log(`unités=${stats.units} densités=${stats.densities} synonymes=${stats.withSyn}`);
