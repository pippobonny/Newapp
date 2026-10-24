/* Prepara i file per l'app Android (Fil, 2026-10-24).
   Copia ../dist (il sito già "leggero" fatto da build.mjs) in ./www e,
   SOLO per l'app (il sito su Vercel non viene toccato):
   - aggiunge class="seeva-native" a <html> in ogni pagina: il CSS dell'app
     (margine sotto la barra di stato ecc.) vale subito, senza "salti";
   - mette DENTRO l'app la libreria Supabase e i caratteri (Inter, Fraunces)
     invece di scaricarli ogni volta da internet (jsdelivr / Google Fonts):
     le pagine si aprono prima e funzionano anche con rete lenta. */
import { promises as fs } from 'fs';
import path from 'path';

const SRC = path.resolve('../dist');
const OUT = path.resolve('www');
const NM = path.resolve('node_modules');

await fs.rm(OUT, { recursive: true, force: true });
await fs.cp(SRC, OUT, { recursive: true });

/* --- libreria Supabase (stessa versione del sito: 2.117.2) --- */
await fs.mkdir(path.join(OUT, 'vendor', 'fonts'), { recursive: true });
await fs.copyFile(path.join(NM, '@supabase/supabase-js/dist/umd/supabase.js'), path.join(OUT, 'vendor', 'supabase.js'));

/* --- caratteri: solo i pesi usati e solo latino + latino esteso --- */
const FONTS = [
  { pkg: '@fontsource/inter', weights: [400, 500, 600, 700] },
  { pkg: '@fontsource/fraunces', weights: [500, 600, 700] }
];
let css = '';
for (const f of FONTS) {
  for (const w of f.weights) {
    const src = await fs.readFile(path.join(NM, f.pkg, w + '.css'), 'utf8');
    for (const block of src.split('/*').slice(1)) {
      const name = block.slice(0, block.indexOf('*/')).trim(); // es. inter-latin-400-normal
      if (!/-latin(-ext)?-\d+-normal$/.test(name)) continue;
      const file = name + '.woff2';
      await fs.copyFile(path.join(NM, f.pkg, 'files', file), path.join(OUT, 'vendor', 'fonts', file));
      const face = block.slice(block.indexOf('@font-face'))
        .replace(/src:[^;]+;/, "src: url(fonts/" + file + ") format('woff2');");
      css += face.trim() + '\n';
    }
  }
}
await fs.writeFile(path.join(OUT, 'vendor', 'fonts.css'), css);

/* --- pagine --- */
let n = 0;
for (const f of await fs.readdir(OUT)) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(OUT, f);
  let html = await fs.readFile(p, 'utf8');
  html = html
    .replace(/<html(\s|>)/i, '<html class="seeva-native"$1')
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"/g, '<script src="vendor/supabase.js"')
    .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" rel="stylesheet">/g, '<link href="vendor/fonts.css" rel="stylesheet">')
    .replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"( crossorigin)?>/g, '')
    .replace(/<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"( crossorigin)?>/g, '');
  await fs.writeFile(p, html);
  n++;
}
console.log('www pronta: ' + n + ' pagine, Supabase e caratteri dentro l\'app');
