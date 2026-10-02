/* ==================================================================
   LIFTR - stockage durable : IndexedDB (repli localStorage si absent)
   Store unique "profiles" : { name, db, savedAt }
   ================================================================== */

const IDB_NAME = 'liftr';
const IDB_STORE = 'profiles';

let _idbConn = null;
let _idbBroken = false;

function idbOpen(){
  if (_idbBroken || !('indexedDB' in window)) return Promise.resolve(null);
  if (_idbConn) return Promise.resolve(_idbConn);
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); } catch (e){ _idbBroken = true; return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'name' });
    };
    req.onsuccess = () => {
      _idbConn = req.result;
      _idbConn.onclose = () => { _idbConn = null; };
      resolve(_idbConn);
    };
    req.onerror = () => { _idbBroken = true; resolve(null); };
    req.onblocked = () => resolve(null);
  });
}

/* fn(store) peut retourner une IDBRequest ; la promesse résout à la fin de la transaction */
function idbTx(mode, fn){
  return idbOpen().then(db => new Promise(resolve => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      const out = fn(store);
      let result = null;
      if (out && typeof out === 'object' && 'result' in out){
        out.onsuccess = () => { result = out.result; };
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch (e){ resolve(null); }
  }));
}

function idbGetProfile(name){
  return idbTx('readonly', s => s.get(name)).then(r => (r && r.db) ? r.db : null);
}

/* Enregistrement complet { name, db, savedAt } — pour comparer la fraicheur */
function idbGetProfileMeta(name){
  return idbTx('readonly', s => s.get(name)).then(r => r || null);
}

function idbPutProfile(name, db){
  const record = { name: name, db: db, savedAt: Date.now() };
  return idbTx('readwrite', s => s.put(record)).catch(() => null);
}

function idbDeleteProfile(name){
  return idbTx('readwrite', s => s.delete(name)).catch(() => null);
}

Object.assign(window, { idbOpen, idbGetProfile, idbGetProfileMeta, idbPutProfile, idbDeleteProfile });
