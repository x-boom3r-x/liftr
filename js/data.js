/* ==================================================================
   LIFTR - constantes & utilitaires purs
   ================================================================== */

import { getCatalogue } from './gym/exercises.js';

const TYPES = ['PUSH','PULL','LEGS','UPPER','FULL','CARDIO','REST'];

/* Library: every exercise grouped by muscle */
const LIB = {
  'Chest': ['Bench press','Dumbbell bench press','Incline press','Incline dumbbell press','Decline press','Machine press','Pec deck (butterfly)','Dumbbell fly','Cable fly','Incline dumbbell fly','Push-ups','Diamond push-ups','Weighted push-ups','Incline push-ups','Dips','Weighted dips','Dumbbell pullover','Cable pullover','Machine chest press','Decline dumbbell press'],
  'Back': ['Pull-ups (overhand)','Chin-ups','Weighted pull-ups','Lat pulldown','Seated row','One-arm pulldown','Behind-neck pulldown','Barbell row','Dumbbell row','Cable row','T-bar row','Machine row','Bent-over dumbbell row','Deadlift','Romanian deadlift','Rack pull','Good morning','Hyperextensions','Face pull','Rear delt fly','Shrugs (traps)','Dumbbell shrugs','High pulley pullover','Renegade row'],
  'Shoulders': ['Overhead press','Dumbbell shoulder press','Arnold press','Behind-neck press','Machine shoulder press','Push press','Lateral raises','Front raises','Rear delt raises','Cable face pull','Upright row','Handstand push-ups','Seated dumbbell press','Cable lateral raises','Dumbbell face pull'],
  'Biceps': ['Barbell curl','EZ bar curl','Dumbbell curl','Hammer curl','Incline curl','Concentration curl','Preacher curl','Cable curl','Spider curl','Zottman curl','Low cable curl','Rope curl','Standing dumbbell curl','Incline bench curl'],
  'Triceps': ['French press','Skull crusher','Cable rope extension','Overhead dumbbell extension','High pulley triceps extension','Triceps dips','Close-grip push-ups','Dumbbell kickback','Seated EZ extension','Single-arm cable extension','Francisco (incline front bar)'],
  'Legs': ['Barbell squat','Dumbbell squat','Goblet squat','Front squat','Smith machine squat','Leg press','Seated leg press','Leg extension','Lying leg curl','Seated leg curl','Walking lunges','Reverse lunges','Bulgarian split squat','Step-up','Romanian deadlift','45° leg press','Hack squat','Adductor (cable)','Abductor (cable)','Standing calf raises','Seated calf raises','Machine calf raises'],
  'Glutes': ['Barbell hip thrust','Machine hip thrust','Glute bridge','Single-leg glute bridge','Donkey kick','Fire hydrant','Glute kickback','All-fours leg raise','Marching glute bridge','Sumo squat','Rotating lunge'],
  'Core': ['Plank','Side plank','Dynamic plank','Hollow body','Ab wheel rollout','Hanging leg raises','Lying leg raises','Crunch','Cable crunch','Russian twist','Mountain climbers','Superman','Sit-up','V-ups','Bird dog','Dead bug'],
  'Cardio': ['Jump rope','Rower','Stationary bike','Treadmill','Elliptical','Burpees','Jumping jacks','Box jump','Sprint','Swimming','Incline walk','Kettlebell swing','Jump squat','Row 500 m']
};
/* Legacy French names -> English (existing profiles keep matching muscle groups) */
const EXO_ALIASES = {
  'développé couché': 'bench press', 'développé couché haltères': 'dumbbell bench press',
  'développé incliné': 'incline press', 'développé incliné haltères': 'incline dumbbell press',
  'développé décliné': 'decline press', 'développé à la machine': 'machine press',
  'pec-deck (papillon)': 'pec deck (butterfly)', 'écarté haltères': 'dumbbell fly',
  'écarté câble': 'cable fly', 'écarté incliné haltères': 'incline dumbbell fly',
  'pompes': 'push-ups', 'pompes diamant': 'diamond push-ups', 'pompes lestées': 'weighted push-ups',
  'pompes surélevées': 'incline push-ups', 'dips': 'dips', 'dips lestés': 'weighted dips',
  'pullover haltère': 'dumbbell pullover', 'pullover câble': 'cable pullover',
  'chest press machine': 'machine chest press', 'développé décliné haltères': 'decline dumbbell press',
  'tractions pronation': 'pull-ups (overhand)', 'tractions supination': 'chin-ups',
  'tractions lestées': 'weighted pull-ups', 'tirage vertical': 'lat pulldown',
  'tirage horizontal': 'seated row', 'tirage à un bras': 'one-arm pulldown',
  'tirage nuque': 'behind-neck pulldown', 'rowing barre': 'barbell row',
  'rowing haltère': 'dumbbell row', 'rowing câble': 'cable row', 'rowing t': 't-bar row',
  'rowing machine': 'machine row', 'rowing penché haltères': 'bent-over dumbbell row',
  'deadlift': 'deadlift', 'soulevé de terre roumain': 'romanian deadlift',
  'rack pull': 'rack pull', 'good morning': 'good morning', 'hyperextensions': 'hyperextensions',
  'face pull': 'face pull', 'oiseau haltères': 'rear delt fly', 'shrugs (trapèzes)': 'shrugs (traps)',
  'shrugs haltères': 'dumbbell shrugs', 'pullover poulie haute': 'high pulley pullover',
  'renegade row': 'renegade row',
  'développé militaire': 'overhead press', 'développé militaire haltères': 'dumbbell shoulder press',
  'développé arnold': 'arnold press', 'développé nuque': 'behind-neck press',
  'push press': 'push press', 'élévations latérales': 'lateral raises',
  'élévations frontales': 'front raises', 'élévations postérieures': 'rear delt raises',
  'poulie visage': 'cable face pull', 'upright row': 'upright row',
  'pompes en appui (handstand)': 'handstand push-ups', 'développé assis haltères': 'seated dumbbell press',
  'élévations latérales câble': 'cable lateral raises', 'face pull haltère': 'dumbbell face pull',
  'curl barre': 'barbell curl', 'curl barre ez': 'ez bar curl', 'curl haltères': 'dumbbell curl',
  'curl marteau': 'hammer curl', 'curl incliné': 'incline curl', 'curl concentré': 'concentration curl',
  'curl pupitre': 'preacher curl', 'curl câble': 'cable curl', 'curl spider': 'spider curl',
  'curl zottman': 'zottman curl', 'curl poulie basse': 'low cable curl', 'curl à la corde': 'rope curl',
  'supination debout haltères': 'standing dumbbell curl', 'curl banc incliné': 'incline bench curl',
  'barre au front': 'french press', 'skull crusher': 'skull crusher',
  'extension câble corde': 'cable rope extension', 'extension haltère derrière la nuque': 'overhead dumbbell extension',
  'extension triceps poulie haute': 'high pulley triceps extension', 'dips triceps': 'triceps dips',
  'pompes serrées': 'close-grip push-ups', 'kickback haltère': 'dumbbell kickback',
  'extension ez assis': 'seated ez extension', 'extension unilatérale câble': 'single-arm cable extension',
  'francisco (barre frontale incliné)': 'francisco (incline front bar)',
  'squat barre': 'barbell squat', 'squat haltères': 'dumbbell squat', 'squat goblet': 'goblet squat',
  'front squat': 'front squat', 'squat à la machine (smith)': 'smith machine squat',
  'leg press': 'leg press', 'presse à cuisse': 'seated leg press', 'extension de cuisse': 'leg extension',
  'leg curl allongé': 'lying leg curl', 'leg curl assis': 'seated leg curl',
  'fentes marchées': 'walking lunges', 'fentes arrière': 'reverse lunges',
  'squat bulgare': 'bulgarian split squat', 'step-up': 'step-up', 'presse 45°': '45° leg press',
  'hack squat': 'hack squat', 'adducteur (poulie)': 'adductor (cable)', 'abducteur (poulie)': 'abductor (cable)',
  'mollets debout': 'standing calf raises', 'mollets assis': 'seated calf raises',
  'mollets à la machine': 'machine calf raises',
  'hip thrust barre': 'barbell hip thrust', 'hip thrust machine': 'machine hip thrust',
  'pont fessier': 'glute bridge', 'pont fessier à une jambe': 'single-leg glute bridge',
  'donkey kick': 'donkey kick', 'fire hydrant': 'fire hydrant', 'kickback fessier': 'glute kickback',
  'élévation de jambe à quatre pattes': 'all-fours leg raise', 'glute bridge marche': 'marching glute bridge',
  'squat sumo': 'sumo squat', 'fente avec rotation': 'rotating lunge',
  'planche (plank)': 'plank', 'planche latérale': 'side plank', 'planche dynamique': 'dynamic plank',
  'hollow body': 'hollow body', 'roue abdominale': 'ab wheel rollout',
  'relevés de jambes suspendu': 'hanging leg raises', 'relevés de jambes couché': 'lying leg raises',
  'crunch': 'crunch', 'crunch câble': 'cable crunch', 'développement russe': 'russian twist',
  'mountain climbers': 'mountain climbers', 'superman': 'superman', 'sit-up': 'sit-up',
  'v-ups': 'v-ups', 'bird dog': 'bird dog', 'dead bug': 'dead bug',
  'corde à sauter': 'jump rope', 'rameur': 'rower', "vélo d'appartement": 'stationary bike',
  'tapis de course': 'treadmill', 'elliptique': 'elliptical', 'burpees': 'burpees',
  'jumping jacks': 'jumping jacks', 'box jump': 'box jump', 'sprint': 'sprint',
  'natation': 'swimming', 'marche inclinée': 'incline walk', 'kettlebell swing': 'kettlebell swing',
  'jump squat': 'jump squat', 'rowing 500 m': 'row 500 m'
};
/* Resolve a legacy French exercise name to its English equivalent */
function exoKey(name){
  const k = String(name || '').toLowerCase().trim();
  return EXO_ALIASES[k] || k;
}
/* ---------------- utils ---------------- */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const pad = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayISO = () => isoOf(new Date());
const parseISO = s => {
  const [y, m, d] = String(s || '').split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
};
const fmtLong = s => parseISO(s).toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
const fmtShort = s => parseISO(s).toLocaleDateString('en-US', { weekday:'short', day:'numeric', month:'short' });

function weekKeyOf(d){
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - dow + 3);
  const firstThu = new Date(t.getFullYear(), 0, 4);
  const fdow = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - fdow + 3);
  const week = 1 + Math.round((t - firstThu) / 604800000);
  return t.getFullYear() + '-W' + pad(week);
}
function weekStartOf(d){
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t;
}
const fmtVolume = v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(1)+'k' : String(v);

function setLine(s){
  if (s.cardio) return cardioLine(s);
  const base = s.weight + ' kg × ' + s.reps;
  return s.assisted > 0 ? base + '<span class="ass">+' + s.assisted + 'A</span>' : base;
}
/* variante texte simple (listes, exports) */
function setShort(s){
  if (s.cardio) return fmtNum(s.min) + ' min' + (s.km ? ' · ' + fmtNum(s.km) + ' km' : '');
  return s.weight + 'kg×' + s.reps + (s.assisted ? '+' + s.assisted + 'A' : '');
}
function volumeOf(s){
  if (s.cardio) return 0;
  return s.weight * (s.reps + s.assisted);
}

/* --- cardio : durée (min) + distance (km) --- */
function isCardioName(name){
  if (!name) return false;
  const k = String(name).toLowerCase().trim();
  /* 1. Exercices legacy LIFTR (toujours disponibles) */
  if ((LIB['Cardio'] || []).some(n => n.toLowerCase().trim() === k)) return true;
  /* 2. Exercices du catalogue openGym (category === 'cardio') */
  const cat = getCatalogue();
  if (cat.length){
    return cat.some(ex => ex._lower === k && (ex.category || '').toLowerCase() === 'cardio');
  }
  return false;
}
function cardioLine(s){
  const parts = [];
  if (s.min > 0) parts.push(fmtNum(s.min) + ' min');
  if (s.km > 0) parts.push(fmtNum(s.km) + ' km');
  return parts.join(' <span class="ass">·</span> ') || '0 min';
}
function fmtNum(n){
  const v = Math.round(+n * 10) / 10;
  return String(v);
}
/* total cardio d'une séance passée (ou d'un actif) */
function cardioTotals(exercises){
  let min = 0, km = 0;
  (exercises || []).forEach(ex => (ex.sets || []).forEach(s => {
    if (s.cardio){ min += +s.min || 0; km += +s.km || 0; }
  }));
  return { min: Math.round(min), km: Math.round(km * 10) / 10 };
}

Object.assign(window, {
  TYPES, LIB, EXO_ALIASES, exoKey, uid, $, esc, pad, isoOf, todayISO, parseISO, fmtLong, fmtShort,
  weekKeyOf, weekStartOf, fmtVolume, setLine, setShort, volumeOf,
  isCardioName, cardioLine, fmtNum, cardioTotals
});
