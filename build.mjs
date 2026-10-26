/* Build di pubblicazione (Fil, 2026-10-05): Vercel lo lancia a ogni push.
   I file nella cartella restano COMPLETI di commenti (servono per lavorarci);
   in dist/ finiscono le versioni "leggere" che scaricano gli utenti:
   - .js e .css minificati (niente commenti, niente spazi inutili);
   - .html senza commenti <!-- -->, con script e stili interni minificati;
   - tutto il resto copiato così com'è.
   Se qualcosa va storto la build si ferma e Vercel lascia online la
   versione precedente: nessun rischio di pubblicare un sito rotto. */
import { transform } from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const SRC = process.cwd();
const OUT = path.join(SRC, 'dist');
// 2026-10-14: fuori dal sito anche branding/ (un SVG da 2,5 MB mai usato
// dalle pagine) e restyling-preview.html (prova grafica, non linkata).
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.claude', '.vercel', 'Claude outputs', 'idee grafiche', 'screenshot bug', 'branding']);
const SKIP_FILES = new Set(['build.mjs', 'package.json', 'package-lock.json', 'vercel.json', '.gitignore', '.gitattributes', 'restyling-preview.html']);
// 2026-10-14: niente PDF sul sito (ci-siamo-*.pdf non servono più, Fil)
const SKIP_EXT = new Set(['.zip', '.bat', '.ps1', '.md', '.pdf']);

async function minifyJS(code, name) {
  const r = await transform(code, { loader: 'js', minify: true, legalComments: 'none', charset: 'utf8', sourcefile: name });
  return r.code;
}
async function minifyCSS(code, name) {
  const r = await transform(code, { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8', sourcefile: name });
  return r.code;
}
async function minifyHTML(html, name) {
  // commenti HTML (non quelli dentro gli script: li toglie esbuild)
  let out = '';
  let i = 0;
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>|<style\b([^>]*)>([\s\S]*?)<\/style>|<!--[\s\S]*?-->/gi;
  let m;
  while ((m = re.exec(html))) {
    out += html.slice(i, m.index);
    if (m[0].startsWith('<!--')) {
      // niente: commento tolto
    } else if (m[0].toLowerCase().startsWith('<script')) {
      const attrs = m[1] || '';
      const body = m[2] || '';
      const isJS = !/\bsrc\s*=/.test(attrs) && (!/\btype\s*=/.test(attrs) || /type\s*=\s*["']?(text\/javascript|module)["']?/i.test(attrs));
      out += '<script' + attrs + '>' + (isJS && body.trim() ? (await minifyJS(body, name + ' <script>')).trim() : body) + '</script>';
    } else {
      out += '<style' + (m[3] || '') + '>' + (await minifyCSS(m[4] || '', name + ' <style>')).trim() + '</style>';
    }
    i = m.index + m[0].length;
  }
  out += html.slice(i);
  return out;
}

let before = 0, after = 0;
async function walk(dir) {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(SRC, abs);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('_') || ent.name.startsWith('.')) continue;
      await walk(abs);
      continue;
    }
    if (SKIP_FILES.has(ent.name) || ent.name.startsWith('Schermata') || SKIP_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    const dest = path.join(OUT, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const ext = path.extname(ent.name).toLowerCase();
    if (ext === '.js' || ext === '.css' || ext === '.html') {
      const src = await fs.readFile(abs, 'utf8');
      const min = ext === '.js' ? await minifyJS(src, rel) : ext === '.css' ? await minifyCSS(src, rel) : await minifyHTML(src, rel);
      before += Buffer.byteLength(src); after += Buffer.byteLength(min);
      await fs.writeFile(dest, min);
    } else {
      await fs.copyFile(abs, dest);
    }
  }
}

await fs.rm(OUT, { recursive: true, force: true });
await walk(SRC);
console.log('Build ok: html/js/css da ' + Math.round(before / 1024) + ' KB a ' + Math.round(after / 1024) + ' KB');

/* ---------- 2026-10-26 (Fil: "super veloce") ----------
   1) Caratteri (Inter, Fraunces) e libreria Supabase serviti dal sito
      stesso, come già nell'app Android: niente più Google Fonts e jsdelivr,
      due collegamenti in meno a ogni prima apertura (chi apre un invito da
      WhatsApp vede la pagina prima).
   2) Service worker: codice di versione + elenco dei file dell'app, che il
      telefono scarica tutti insieme e poi apre senza rete (vedi sw.js). */
const NM = path.join(SRC, 'node_modules');
const VENDOR = path.join(OUT, 'vendor');
await fs.mkdir(path.join(VENDOR, 'fonts'), { recursive: true });
await fs.copyFile(path.join(NM, '@supabase/supabase-js/dist/umd/supabase.js'), path.join(VENDOR, 'supabase.js'));
const FONTS = [
  { pkg: '@fontsource/inter', weights: [400, 500, 600, 700] },
  { pkg: '@fontsource/fraunces', weights: [500, 600, 700] }
];
let fontCss = '';
const fontFiles = [];
for (const f of FONTS) {
  for (const w of f.weights) {
    const src = await fs.readFile(path.join(NM, f.pkg, w + '.css'), 'utf8');
    for (const block of src.split('/*').slice(1)) {
      const name = block.slice(0, block.indexOf('*/')).trim();
      if (!/-latin(-ext)?-\d+-normal$/.test(name)) continue;
      const file = name + '.woff2';
      await fs.copyFile(path.join(NM, f.pkg, 'files', file), path.join(VENDOR, 'fonts', file));
      fontFiles.push('vendor/fonts/' + file);
      fontCss += block.slice(block.indexOf('@font-face')).replace(/src:[^;]+;/, "src: url(fonts/" + file + ") format('woff2');").trim() + '\n';
    }
  }
}
await fs.writeFile(path.join(VENDOR, 'fonts.css'), await minifyCSS(fontCss, 'vendor/fonts.css'));
const PRELOAD = '<link rel="preload" href="vendor/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>'
  + '<link rel="preload" href="vendor/fonts/fraunces-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>';

const pages = (await fs.readdir(OUT)).filter((f) => f.endsWith('.html'));
for (const f of pages) {
  const p = path.join(OUT, f);
  let html = await fs.readFile(p, 'utf8');
  html = html
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"/g, '<script src="vendor/supabase.js"')
    .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" rel="stylesheet">/g, PRELOAD + '<link href="vendor/fonts.css" rel="stylesheet">')
    .replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"( crossorigin)?>/g, '')
    .replace(/<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"( crossorigin)?>/g, '')
    // le pagine principali le prepara già il service worker
    .replace(/<link rel="prefetch" href="[a-z-]+\.html">/g, '');
  await fs.writeFile(p, html);
}

// File dell'app per il service worker: pagine dell'app (non quelle di
// servizio), script, stili, caratteri, Supabase, icone.
const SHELL_SKIP = new Set(['admin.html', 'presentazione.html', 'privacy.html']);
const shell = pages.filter((f) => !SHELL_SKIP.has(f) && !/^google[0-9a-f]+\.html$/.test(f))
  .concat(['script.js', 'data.js', 'style.css', 'i18n.js', 'i18n-en.js', 'manifest.json',
    'vendor/supabase.js', 'vendor/fonts.css', 'icon-192.png', 'badge-96.png', 'favicon.ico'])
  .concat(fontFiles);
const hash = createHash('sha1');
for (const f of shell) hash.update(f).update(await fs.readFile(path.join(OUT, f)));
const buildId = hash.digest('hex').slice(0, 12);
const swPath = path.join(OUT, 'sw.js');
let sw = await fs.readFile(swPath, 'utf8');
if (!sw.includes('__SEEVA_BUILD__') || !sw.includes('__SEEVA_SHELL__')) throw new Error('sw.js: segnaposto di versione non trovati');
sw = sw.replace(/(["'])__SEEVA_BUILD__\1/, JSON.stringify(buildId)).replace(/(["'])__SEEVA_SHELL__\1/, JSON.stringify(shell));
await fs.writeFile(swPath, sw);
console.log('Velocità: caratteri e Supabase dal sito, service worker versione ' + buildId + ' con ' + shell.length + ' file');
