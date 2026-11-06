/* ==================================================================
   LIFTR - carte musculaire (SVG maison)
   Silhouettes avant / arrière dessinées ici : aucun asset externe,
   aucune géométrie reprise d'un autre projet (licences d'images).
   ================================================================== */

/* --- zones : [groupe|null, forme...] ; null = silhouette de base --- */
const BM_SHAPES = {
  front: {
    base: [
      ['circle', 60, 24, 13],
      ['rect', 55, 34, 10, 9, 3],
      ['rect', 24, 93, 12, 22, 5], ['rect', 84, 93, 12, 22, 5],
      ['rect', 43, 104, 34, 12, 5],
      ['rect', 42, 164, 15, 32, 6], ['rect', 63, 164, 15, 32, 6],
      ['rect', 40, 198, 18, 8, 4], ['rect', 62, 198, 18, 8, 4]
    ],
    zones: {
      Shoulders: [['rect', 31, 44, 17, 17, 8], ['rect', 72, 44, 17, 17, 8]],
      Chest:     [['rect', 41, 48, 38, 25, 9]],
      Biceps:    [['rect', 25, 66, 13, 25, 6], ['rect', 82, 66, 13, 25, 6]],
      Core:      [['rect', 46, 76, 28, 31, 6]],
      Legs:      [['rect', 41, 116, 17, 44, 7], ['rect', 62, 116, 17, 44, 7]]
    },
    title: ['FRONT', 62]
  },
  back: {
    base: [
      ['circle', 160, 24, 13],
      ['rect', 155, 34, 10, 9, 3],
      ['rect', 124, 93, 12, 22, 5], ['rect', 184, 93, 12, 22, 5],
      ['rect', 142, 198, 18, 8, 4], ['rect', 160, 198, 18, 8, 4]
    ],
    zones: {
      Back:      [['rect', 142, 44, 36, 17, 7], ['rect', 138, 60, 44, 30, 9]],
      Triceps:   [['rect', 125, 66, 13, 25, 6], ['rect', 182, 66, 13, 25, 6]],
      Glutes:    [['rect', 143, 92, 34, 25, 10]],
      Legs:      [['rect', 144, 120, 16, 40, 7], ['rect', 160, 120, 16, 40, 7],
                  ['rect', 145, 164, 14, 31, 6], ['rect', 161, 164, 14, 31, 6]]
    },
    title: ['BACK', 162]
  }
};

function _bmShape(s, cls, fill){
  if (s[0] === 'circle')
    return '<circle class="' + cls + '" cx="' + s[1] + '" cy="' + s[2] + '" r="' + s[3] +
      '" fill="' + fill + '"/>';
  return '<rect class="' + cls + '" x="' + s[1] + '" y="' + s[2] + '" width="' + s[3] +
    '" height="' + s[4] + '" rx="' + (s[5] || 0) + '" fill="' + fill + '"/>';
}

function _bmFill(score){
  if (!(score > 0)) return 'var(--surface3)';
  const a = (0.16 + 0.7 * Math.min(1, score)).toFixed(3);
  return 'rgba(255,107,53,' + a + ')';
}

/* Volume (kg × reps) par groupe LIB sur N jours, normalisé 0..1.
   Même règle que muscleSplit() de stats.js, mais par groupe LIB brut
   (Chest, Back, Legs, Glutes, Shoulders, Biceps, Triceps, Core). */
function muscleScores(days){
  const n = days || 30;
  const mm = (typeof window.muscleMap === 'function') ? window.muscleMap() : {};
  const agg = {};
  const today = todayISO();
  (DB.history || []).forEach(h => {
    if (!h || !h.date) return;
    const ago = Math.round((new Date(today + 'T00:00:00') - new Date(h.date + 'T00:00:00')) / 86400000);
    if (isNaN(ago) || ago < 0 || ago >= n) return;
    (h.exercises || []).forEach(ex => {
      const sets = (ex.sets || []).filter(s => !s.cardio);
      if (!sets.length) return;
      const g = mm[String(ex.name || '').toLowerCase().trim()];
      if (!g || g === 'Cardio') return;
      const v = sets.reduce((t, s) => t + (typeof volumeOf === 'function' ? volumeOf(s) : 0), 0);
      agg[g] = (agg[g] || 0) + v;
    });
  });
  let max = 0;
  Object.keys(agg).forEach(k => { if (agg[k] > max) max = agg[k]; });
  const out = {};
  Object.keys(agg).forEach(k => { out[k] = max > 0 ? agg[k] / max : 0; });
  return out;
}

/* HTML de la carte : silhouettes + légende.
   opts = { scores, selected, select(bool → zones cliquables) } */
function bodyMapHtml(opts){
  const o = opts || {};
  const sc = o.scores || {};
  const sel = o.selected || '';
  const clickable = !!o.select;
  let hasData = false;
  Object.keys(sc).forEach(k => { if (sc[k] > 0) hasData = true; });

  const side = key => {
    const cfg = BM_SHAPES[key];
    let g = cfg.base.map(s => _bmShape(s, 'bm-base', 'var(--surface2)')).join('');
    Object.keys(cfg.zones).forEach(muscle => {
      const score = sc[muscle] || 0;
      if (score > 0) hasData = true;
      const fill = _bmFill(score);
      const on = sel === muscle ? ' on' : '';
      const cls = 'bm-hit' + on;
      const inner = cfg.zones[muscle].map(s => _bmShape(s, 'bm-zone', fill)).join('');
      const attrs = clickable
        ? ' class="' + cls + '" data-m="' + muscle + '" onclick="bmPick(\'' + muscle + '\')" role="button" tabindex="0"'
        : ' class="bm-static"';
      g += '<g' + attrs + '>' + inner + '</g>';
    });
    g += '<text class="bm-title" x="' + cfg.title[1] + '" y="222">' + cfg.title[0] + '</text>';
    return g;
  };

  return '<div class="bodymap">' +
      '<svg viewBox="0 0 220 230" role="img" aria-label="Muscle map">' +
        side('front') + side('back') +
      '</svg>' +
    '</div>' +
    (hasData
      ? '<div class="bm-legend"><span>Less</span>' +
          '<i style="background:linear-gradient(90deg,var(--surface3),rgba(255,107,53,.86))"></i>' +
          '<span>More volume · last ' + (o.days || 30) + ' days</span></div>'
      : '<div class="bm-empty">No sessions logged in the last ' + (o.days || 30) +
        ' days yet — finish a session and the map lights up.</div>');
}

Object.assign(window, { muscleScores, bodyMapHtml });
