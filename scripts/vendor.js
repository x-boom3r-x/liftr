/* Vendorise le build UMD de supabase-js.
   Ce projet n'a aucun bundler (0 vite/webpack/esbuild) : le dist ESM
   importe ~17 modules sous forme bare et ne peut donc pas être utilisé tel quel.
   Le fichier UMD est un IIFE auto-contenu, chargé par un simple <script>.
   Usage : npm run vendor */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = path.join(root, 'node_modules', '@supabase', 'supabase-js');
const dist = path.join(pkg, 'dist', 'umd', 'supabase.js');
const outDir = path.join(root, 'js', 'vendor');

if (!fs.existsSync(dist)){
  console.error('Missing ' + dist + '\nRun: npm install first.');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(dist, path.join(outDir, 'supabase.js'));
fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(outDir, 'supabase.LICENSE'));

const kb = (fs.statSync(path.join(outDir, 'supabase.js')).size / 1024).toFixed(1);
console.log('vendored @supabase/supabase-js ' +
  require(path.join(pkg, 'package.json')).version + ' (' + kb + ' KB) -> js/vendor/supabase.js');
