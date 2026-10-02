/* ==================================================================
   LIFTR - partage / import de programme
   ================================================================== */


let pendingImport = null;
let importMode = 'replace';

/* ---------- partage de programme ---------- */
function buildSharePayload(){
  return {
    app: 'liftr', kind: 'programme', v: 1,
    from: currentUser, at: new Date().toISOString(),
    programme: (DB.programme || []).map(d => ({
      id: d.id, name: d.name, type: d.type,
      exercises: (d.exercises || []).map(e => ({ id: e.id, name: e.name }))
    })),
    custom: (DB.custom || []).slice()
  };
}
function b64Encode(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function b64Decode(s){
  const bin = atob(s);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function parseShare(text){
  const t = (text || '').trim();
  if (!t) return null;
  let obj = null;
  try { obj = JSON.parse(t); } catch(e){
    const tries = [];
    try { tries.push(b64Decode(decodeURIComponent(t))); } catch(e){}
    try { tries.push(b64Decode(t)); } catch(e){}
    for (const c of tries){
      if (obj) break;
      try { obj = JSON.parse(c); } catch(e){}
    }
  }
  if (!obj || obj.kind !== 'programme' || !Array.isArray(obj.programme)) return null;
  obj.programme = obj.programme
    .filter(d => d && typeof d.name === 'string' && d.name.trim())
    .map(d => ({
      id: d.id || uid(),
      name: String(d.name).slice(0, 40),
      type: TYPES.includes(d.type) ? d.type : 'PUSH',
      exercises: (Array.isArray(d.exercises) ? d.exercises : [])
        .filter(e => e && typeof e.name === 'string' && e.name.trim())
        .map(e => ({ id: e.id || uid(), name: String(e.name).slice(0, 60) }))
    }));
  if (!obj.programme.length) return null;
  return obj;
}

let sharePayloadJSON = '';
function openShare(){
  const days = DB.programme || [];
  const exos = new Set(days.flatMap(d => d.exercises.map(e => e.name.toLowerCase().trim())));
  $('shareSummary').textContent = currentUser + ' · ' + days.length + ' day' + (days.length !== 1 ? 's' : '') +
    ' · ' + exos.size + ' exercise' + (exos.size !== 1 ? 's' : '');
  if (!days.length){
    $('shareSummary').textContent = 'Your program is empty: add a day first.';
    $('shareCode').value = ''; $('shareLink').value = '';
  } else {
    sharePayloadJSON = JSON.stringify(buildSharePayload());
    const code = b64Encode(sharePayloadJSON);
    $('shareCode').value = code;
    const base = (location.origin && location.origin !== 'null')
      ? location.origin + location.pathname
      : location.href.split('?')[0];
    $('shareLink').value = base + '?share=' + encodeURIComponent(code);
  }
  $('copyCodeBtn').disabled = !days.length;
  openModal('shareModal');
}
function copyShareCode(){
  const ta = $('shareCode');
  if (!ta.value) return;
  const done = () => toast('Code copied ✓');
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value).then(done).catch(() => fallbackCopy(ta, done));
  } else fallbackCopy(ta, done);
}
function fallbackCopy(ta, done){
  ta.focus(); ta.select();
  try { if (document.execCommand('copy')) { done(); return; } } catch(e){}
  toast('Select the code and copy it (Ctrl+C)');
}
function shareNative(){
  const link = $('shareLink').value;
  const code = $('shareCode').value;
  if (!code) return;
  const http = location.protocol === 'http:' || location.protocol === 'https:';
  const payload = { title: 'My Liftr program', text: http ? link : code };
  if (navigator.share){
    navigator.share(payload).catch(() => {});
  } else {
    copyShareCode();
  }
}
function downloadShare(){
  if (!sharePayloadJSON) return;
  const blob = new Blob([sharePayloadJSON], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'liftr-program-' + (currentUser || 'profile').toLowerCase() + '.json';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  toast('File downloaded ✓');
}

function openImport(code){
  if (code != null) $('importCode').value = code;
  previewImport();
  openModal('importModal');
}
function onImportFile(input){
  const f = input.files && input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { $('importCode').value = String(r.result || ''); previewImport(); };
  r.readAsText(f);
}
function previewImport(){
  const hint = $('importHint'), prev = $('importPreview'), btn = $('importBtn');
  pendingImport = null;
  btn.disabled = true;
  const raw = $('importCode').value.trim();
  if (!raw){ hint.className = 'hint'; hint.textContent = 'Waiting for a code.'; prev.innerHTML = ''; return; }
  const p = parseShare(raw);
  if (!p){
    hint.className = 'hint err';
    hint.textContent = 'Invalid or incomplete code. Copy it entirely (or pick the file).';
    prev.innerHTML = '';
    return;
  }
  pendingImport = p;
  hint.className = 'hint ok';
  hint.textContent = 'Valid code ✓ ' + p.programme.length + ' session(s) found';

  const exos = new Set();
  p.programme.forEach(d => d.exercises.forEach(e => exos.add(e.name.toLowerCase())));
  const localN = (DB.programme || []).length;
  importMode = localN ? 'merge' : 'replace';

  prev.innerHTML =
    '<div class="preview-card">' +
      '<div class="preview-title">' + esc(p.from || 'Other profile') + ' · ' + p.programme.length + ' day' + (p.programme.length !== 1 ? 's' : '') +
        ' · ' + exos.size + ' exercise' + (exos.size !== 1 ? 's' : '') +
        ((p.custom || []).length ? ' · ' + p.custom.length + ' custom' : '') + '</div>' +
      '<div class="preview-sub">' + (p.at ? 'shared on ' + new Date(p.at).toLocaleDateString('en-US') + ' · ' : '') +
        (localN ? 'your program has ' + localN + ' day(s)' : 'your program is empty') + '</div>' +
      '<div class="preview-days">' + p.programme.map(d =>
        '<span class="preview-day">' + esc(d.name) + ' · ' + d.exercises.length + ' exo</span>').join('') + '</div>' +
      (localN
        ? '<div class="label" style="margin-top:12px">Import mode</div><div class="type-picker" id="importModePicker"></div>'
        : '') +
    '</div>';
  if (localN) renderImportModePicker();
  btn.disabled = false;
}
function renderImportModePicker(){
  const el = $('importModePicker');
  if (!el) return;
  const opts = [['merge', 'Add to my program'], ['replace', 'Replace my program']];
  el.innerHTML = opts.map(o =>
    '<button class="type-opt' + (importMode === o[0] ? ' on' : '') + '" data-m="' + o[0] + '">' + o[1] + '</button>'
  ).join('');
  el.querySelectorAll('.type-opt').forEach(b => b.onclick = () => { importMode = b.dataset.m; renderImportModePicker(); });
}
function applyImport(){
  const p = pendingImport;
  if (!p) return;

  if (importMode === 'replace'){
    const keep = new Set(p.programme.map(d => d.id));
    DB.history.forEach(h => { if (h.dayId && !keep.has(h.dayId)) h.dayId = null; });
    DB.programme = p.programme;
  } else {
    const byName = new Set(DB.programme.map(d => d.name.toLowerCase().trim()));
    p.programme.forEach(d => {
      if (byName.has(d.name.toLowerCase().trim())) return;
      let id = d.id;
      if (DB.programme.some(x => x.id === id) || DB.history.some(h => h.dayId === id)) id = uid();
      const exIds = {};
      d.exercises.forEach(e => { exIds[e.id] = uid(); });
      DB.programme.push({
        id: id, name: d.name, type: d.type,
        exercises: d.exercises.map(e => ({ id: exIds[e.id], name: e.name }))
      });
      byName.add(d.name.toLowerCase().trim());
    });
  }

  if (Array.isArray(p.custom)){
    if (!DB.custom) DB.custom = [];
    p.custom.forEach(n => {
      const k = String(n).trim();
      if (k && !DB.custom.some(x => x.toLowerCase() === k.toLowerCase())) DB.custom.push(k);
    });
  }

  /* re-lie les séances passées au jour partagé qui porte le même nom */
  const nameToId = {};
  DB.programme.forEach(d => { nameToId[d.name.toLowerCase().trim()] = d.id; });
  DB.history.forEach(h => {
    if (!h.dayId && h.dayName && nameToId[String(h.dayName).toLowerCase().trim()]) h.dayId = nameToId[String(h.dayName).toLowerCase().trim()];
  });

  const n = DB.programme.length;
  pendingImport = null;
  save();
  renderAll();
  closeModal('importModal');
  toast('Program imported ✓ ' + n + ' day(s)');
}

/* ---------- sauvegarde complète du profil (toutes données) ---------- */
function exportBackup(){
  const payload = { app: 'liftr-backup', v: 1, profile: currentUser, at: new Date().toISOString(), db: DB };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'liftr-backup-' + (currentUser || 'profile').toLowerCase() + '.json';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  toast('Backup downloaded ✓');
}

function importBackup(input){
  const f = input.files && input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    let p = null;
    try { p = JSON.parse(String(r.result || '')); } catch (e){ p = null; }
    if (!p || p.app !== 'liftr-backup' || !p.db || !Array.isArray(p.db.programme)){
      toast('Invalid backup file.');
      input.value = '';
      return;
    }
    askConfirm('Restore this backup?',
      'Profile: ' + (p.profile || '?') + ' · ' + p.db.programme.length + ' day(s) · ' +
      (p.db.history || []).length + ' session(s).\nThis profile\'s CURRENT data will be replaced.',
      'Restore')
    .then(res => {
      input.value = '';
      if (!res.ok) return;
      DB = Object.assign(defaultDB(), p.db);
      normalizeDB();
      save();
      renderAll();
      toast('Backup restored ✓');
    });
  };
  r.readAsText(f);
}

Object.assign(window, {
  buildSharePayload, b64Encode, b64Decode, parseShare, openShare, copyShareCode,
  fallbackCopy, shareNative, downloadShare, openImport, onImportFile, previewImport,
  renderImportModePicker, applyImport, exportBackup, importBackup
});
