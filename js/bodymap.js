/* Anatomical workout map. Muscle paths are the MIT geometry acknowledged in
   NOTICE.md; session volumes remain calculated from LIFTR's own workout data. */
import BODY_PATHS from './bodymap-data.js';

const MUSCLES = [
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus', 'biceps', 'triceps',
  'forearm', 'abs', 'obliques', 'lower-back', 'gluteal', 'quadriceps', 'hamstring',
  'adductors', 'hip-flexors', 'calves', 'tibialis'
];
const INERT = ['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles'];
const ROOT_GROUP = {
  trapezius: 'Back', 'upper-back': 'Back', 'lower-back': 'Back',
  deltoids: 'Shoulders', chest: 'Chest', serratus: 'Chest',
  biceps: 'Biceps', triceps: 'Triceps', forearm: 'Arms',
  abs: 'Core', obliques: 'Core', gluteal: 'Glutes',
  quadriceps: 'Legs', hamstring: 'Legs', adductors: 'Legs',
  'hip-flexors': 'Legs', calves: 'Legs', tibialis: 'Legs'
};

function normalizeGroup(group){
  const value = String(group || '').trim().toLowerCase();
  if (/^(upper|lower) arms$/.test(value) || value === 'arms') return 'Arms';
  if (/^(upper|lower) legs$/.test(value) || value === 'legs') return 'Legs';
  if (value === 'waist') return 'Core';
  if (value === 'full body') return 'Other';
  return value.replace(/\b\w/g, letter => letter.toUpperCase());
}

function scoreForSlug(scores, slug){
  const group = ROOT_GROUP[slug];
  const candidates = [scores[group] || 0];
  if (group === 'Arms') candidates.push(scores.Biceps || 0, scores.Triceps || 0);
  if (group === 'Legs') candidates.push(scores.Glutes || 0);
  return Math.max(...candidates);
}

function muscleScores(days){
  const n = days || 30;
  const mm = typeof window.muscleMap === 'function' ? window.muscleMap() : {};
  const agg = {};
  const today = todayISO();
  (DB.history || []).forEach(h => {
    if (!h || !h.date) return;
    const ago = Math.round((new Date(today + 'T00:00:00') - new Date(h.date + 'T00:00:00')) / 86400000);
    if (!Number.isFinite(ago) || ago < 0 || ago >= n) return;
    (h.exercises || []).forEach(ex => {
      const sets = (ex.sets || []).filter(s => !s.cardio);
      if (!sets.length) return;
      const group = mm[String(ex.name || '').toLowerCase().trim()];
      if (!group || group === 'Cardio') return;
      const volume = sets.reduce((sum, set) => sum + (typeof volumeOf === 'function' ? volumeOf(set) : 0), 0);
      const bucket = normalizeGroup(group);
      agg[bucket] = (agg[bucket] || 0) + volume;
    });
  });
  const max = Math.max(0, ...Object.values(agg));
  return Object.fromEntries(Object.entries(agg).map(([group, volume]) => [group, max ? volume / max : 0]));
}

function levelFor(score){
  if (!(score > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil(score * 4)));
}

function bodyMapHtml(opts){
  const o = opts || {};
  const scores = o.scores || {};
  const body = BODY_PATHS[o.body] ? o.body : 'male';
  const clickable = !!o.select;
  const levels = {};
  MUSCLES.forEach(slug => { levels[slug] = levelFor(scoreForSlug(scores, slug)); });

  const renderView = (key, label) => {
    const view = BODY_PATHS[body][key];
    let paths = '';
    INERT.forEach(slug => {
      (view.p[slug] || []).forEach((d, i) => { paths += '<path class="bm-sil" key="' + slug + i + '" d="' + d + '"></path>'; });
    });
    MUSCLES.forEach(slug => {
      const group = ROOT_GROUP[slug];
      const isSelected = !!(o.selected && (o.selected === slug || String(o.selected).toLowerCase() === String(group).toLowerCase()));
      const attrs = clickable && group
        ? ' role="button" tabindex="0" aria-pressed="' + isSelected + '" aria-label="Select ' + slug.replace(/-/g, ' ') + ' muscle" onclick="bmPickMuscle(\'' + slug + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();bmPickMuscle(\'' + slug + '\')}"'
        : '';
      (view.p[slug] || []).forEach((d, i) => {
        const selected = isSelected ? ' selected' : '';
        paths += '<path class="bm-m l' + levels[slug] + (clickable ? ' bm-hit' : '') + selected + '" data-muscle="' + slug + '"' + attrs + ' d="' + d + '"><title>' + slug.replace(/-/g, ' ') + '</title></path>';
      });
    });
    return '<div class="bodymap-figure"><div class="bodymap-view-label">' + label + '</div>' +
      '<svg class="bm-v" viewBox="' + view.vb + '" role="' + (clickable ? 'group' : 'img') + '" aria-label="' + label + ' muscle map">' + paths + '</svg></div>';
  };

  const hasData = Object.values(scores).some(value => value > 0);
  return '<div class="bodymap" data-model="' + body + '">' +
      renderView('front', 'FRONT') + renderView('back', 'BACK') +
    '</div>' +
    '<div class="bm-legend"><span>Less</span><i aria-hidden="true"></i><span>More volume · last ' + (o.days || 30) + ' days</span></div>' +
    (!hasData ? '<div class="bm-empty">Finish a workout to light up the muscles you train.</div>' : '');
}

function renderTodayBodyMap(){
  const host = document.getElementById('todayBodyMap');
  if (!host || !window.DB) return;
  const model = DB.bodyMapModel === 'female' ? 'female' : 'male';
  const scores = muscleScores(30);
  host.innerHTML = '<div class="bodymap-switch" role="group" aria-label="Body model">' +
    '<button type="button" class="' + (model === 'male' ? 'active' : '') + '" aria-pressed="' + (model === 'male') + '" onclick="setBodyMapModel(\'male\')">Man</button>' +
    '<button type="button" class="' + (model === 'female' ? 'active' : '') + '" aria-pressed="' + (model === 'female') + '" onclick="setBodyMapModel(\'female\')">Woman</button>' +
    '</div>' + bodyMapHtml({ scores, body: model, days: 30, select: true });
}

function setBodyMapModel(model){
  if (!window.DB) return;
  DB.bodyMapModel = model === 'female' ? 'female' : 'male';
  save();
  renderTodayBodyMap();
  if (currentTab === 'stats' && typeof window.renderStats === 'function') renderStats();
}

Object.assign(window, { muscleScores, bodyMapHtml, renderTodayBodyMap, setBodyMapModel });
