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

const SRC = process.cwd();
const OUT = path.join(SRC, 'dist');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.claude', '.vercel', 'Claude outputs', 'idee grafiche', 'screenshot bug']);
const SKIP_FILES = new Set(['build.mjs', 'package.json', 'package-lock.json', 'vercel.json', '.gitignore', '.gitattributes']);
const SKIP_EXT = new Set(['.zip', '.bat', '.ps1', '.md']);

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
