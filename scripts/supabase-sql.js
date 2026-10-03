/* Exécute un fichier SQL contre un projet Supabase
   via la Management API (POST /v1/projects/{ref}/database/query).

   Usage :
     $env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
     node scripts/supabase-sql.js supabase/migrations/00000000000000_init_social.sql
*/
const fs = require('fs');

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_REF || 'fgpbhosklbcaapijmnkj';
const file = process.argv[2];

if (!token){ console.error('SUPABASE_ACCESS_TOKEN manquant'); process.exit(1); }
if (!file){ console.error('Usage: node scripts/supabase-sql.js <fichier.sql>'); process.exit(1); }

const sql = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');

fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
}).then(async r => {
  const text = await r.text();
  console.log('HTTP ' + r.status + '  (' + file + ')');
  console.log(text.slice(0, 6000));
  if (!r.ok) process.exit(1);
}).catch(e => { console.error('ERR ' + e.message); process.exit(1); });
