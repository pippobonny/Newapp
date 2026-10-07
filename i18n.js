/* Lingua dell'app (Fil, 2026-10-07): italiano + inglese.

   - Lingua scelta: quella salvata a mano nel Profilo (localStorage
     seeva:lang) vince sempre; altrimenti quella del telefono
     (navigator.languages): "it..." -> italiano, tutto il resto -> inglese.
   - Il testo dell'app resta scritto in italiano nel codice. In inglese:
     1) i testi fissi vengono tradotti al volo appena entrano nella pagina
        (MutationObserver: i callback girano PRIMA che lo schermo venga
        ridisegnato, quindi niente "lampo" di italiano), cercandoli tali e
        quali nel dizionario SEEVA_EN (i18n-en.js);
     2) le frasi con dentro nomi/numeri passano da t() nel codice:
        t('Ti ha invitato {name}', { name: 'Fil' }).
   - Mai tradotto: tutto ciò che sta dentro un elemento con data-no-i18n
     (nomi eventi, commenti, avvisi...), campi di testo, script, stili.
   - alert / confirm / prompt passano anche loro dal dizionario.
   - Date: SeevaI18n.locale() -> 'it-IT' o 'en-GB'.

   Va caricato per PRIMO nell'<head> di ogni pagina, prima di tutto il resto
   (anche di i18n-en.js, che subito dopo riempie il dizionario). */
(function () {
  'use strict';
  var LANG_KEY = 'seeva:lang';

  function detect() {
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved === 'it' || saved === 'en') return saved;
    } catch (err) { /* niente localStorage */ }
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'it'];
    var first = String(langs[0] || 'it').toLowerCase();
    return first.indexOf('it') === 0 ? 'it' : 'en';
  }

  var lang = detect();
  try { document.documentElement.lang = lang; } catch (err) { /* ok */ }

  var dict = window.SEEVA_EN = window.SEEVA_EN || {};
  var patterns = window.SEEVA_EN_PATTERNS = window.SEEVA_EN_PATTERNS || [];
  var missing = {};

  function interpolate(s, vars) {
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m; });
  }

  // Traduzione di una stringa intera, tale e quale (spazi ai bordi preservati).
  function lookup(text) {
    if (lang === 'it' || text == null) return null;
    var s = String(text);
    var core = s.trim();
    if (!core) return null;
    var hit = Object.prototype.hasOwnProperty.call(dict, core) ? dict[core] : null;
    if (hit == null) {
      for (var i = 0; i < patterns.length; i++) {
        var m = core.match(patterns[i][0]);
        if (m) { hit = core.replace(patterns[i][0], patterns[i][1]); break; }
      }
    }
    if (hit == null) {
      // pezzi di frase attorno a nomi/numeri ("Promemoria mandato a 3 persone:")
      var frags = window.SEEVA_EN_FRAGS || [];
      var out = core, changed = false;
      for (var f = 0; f < frags.length; f++) {
        if (out.indexOf(frags[f][0]) !== -1) { out = out.split(frags[f][0]).join(frags[f][1]); changed = true; }
      }
      if (changed) hit = out;
    }
    if (hit == null) return null;
    var lead = s.match(/^\s*/)[0];
    var trail = s.match(/\s*$/)[0];
    return lead + hit + trail;
  }

  function t(it, vars) {
    if (lang !== 'it') {
      var hit = Object.prototype.hasOwnProperty.call(dict, it) ? dict[it] : null;
      if (hit == null) { var l2 = lookup(it); if (l2 != null) hit = l2; else { missing[it] = true; hit = it; } }
      return interpolate(hit, vars);
    }
    return interpolate(it, vars);
  }

  // Testi lunghi (alert/confirm): intero, altrimenti riga per riga.
  function translateMessage(msg) {
    if (lang === 'it' || msg == null) return msg;
    var whole = lookup(msg);
    if (whole != null) return whole;
    return String(msg).split('\n').map(function (line) { var x = lookup(line); return x == null ? line : x; }).join('\n');
  }

  /* ---------- traduzione della pagina ---------- */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var done = typeof WeakMap !== 'undefined' ? new WeakMap() : null; // nodo -> testo inglese messo da noi

  function skipped(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP_TAGS[n.tagName]) return true;
      if (n.hasAttribute && n.hasAttribute('data-no-i18n')) return true;
      if (n.isContentEditable) return true;
    }
    return false;
  }

  function translateText(node) {
    var v = node.nodeValue;
    if (!v || !/[A-Za-zÀ-ÿ]/.test(v)) return;
    if (done && done.get(node) === v) return;
    if (!node.parentNode || skipped(node.parentNode)) return;
    var x = lookup(v);
    if (x != null && x !== v) { node.nodeValue = x; if (done) done.set(node, x); }
    else if (looksItalian(v)) { missing[v.trim()] = true; }
  }

  function translateAttrs(el) {
    // i campi di testo hanno il contenuto escluso, ma il loro placeholder no
    if (el.hasAttribute('data-no-i18n') || (el.parentNode && el.parentNode.nodeType === 1 && skipped(el.parentNode))) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]);
      if (a) { var x = lookup(a); if (x != null && x !== a) el.setAttribute(ATTRS[i], x); }
    }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) {
      var xv = lookup(el.value); if (xv != null) el.value = xv;
    }
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      translateAttrs(root);
      if (skipped(root)) return;
    }
    var walker = document.createTreeWalker(root, 5 /* ELEMENT | TEXT */, {
      acceptNode: function (n) {
        if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-no-i18n')) return 2; // REJECT (salta anche i figli)
        if (n.nodeType === 1 && SKIP_TAGS[n.tagName]) { translateAttrs(n); return 2; }
        return 1;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) translateText(n); else translateAttrs(n);
    }
  }

  // Riconoscere l'italiano rimasto non tradotto (solo per i test: window.SeevaI18n.missing()).
  function looksItalian(s) {
    return /[àèéìòù]|\b(il|lo|la|gli|le|di|che|non|per|con|sei|una?|del|della|chi|cosa|quando|dove|tutti|ancora|nessuno|evento|eventi|data|date|ci)\b/i.test(s);
  }

  if (lang !== 'it' && window.MutationObserver) {
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList') {
          for (var j = 0; j < r.addedNodes.length; j++) translateTree(r.addedNodes[j]);
        } else if (r.type === 'characterData') {
          translateText(r.target);
        } else if (r.type === 'attributes') {
          translateAttrs(r.target);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
    document.addEventListener('DOMContentLoaded', function () { translateTree(document.documentElement); });

    var _alert = window.alert, _confirm = window.confirm, _prompt = window.prompt;
    window.alert = function (m) { return _alert.call(window, translateMessage(m)); };
    window.confirm = function (m) { return _confirm.call(window, translateMessage(m)); };
    window.prompt = function (m, d) { return _prompt.call(window, translateMessage(m), d); };
  }

  window.t = t;
  window.SeevaI18n = {
    lang: lang,
    isEnglish: lang === 'en',
    t: t,
    tr: translateMessage,
    locale: function () { return lang === 'en' ? 'en-GB' : 'it-IT'; },
    // Scelta manuale dal Profilo: salva e ricarica la pagina.
    setLang: function (l) {
      try { if (l) localStorage.setItem(LANG_KEY, l); else localStorage.removeItem(LANG_KEY); } catch (err) { /* ok */ }
      window.location.reload();
    },
    savedLang: function () { try { return localStorage.getItem(LANG_KEY); } catch (err) { return null; } },
    phoneLang: function () { var l = (navigator.languages && navigator.languages[0]) || navigator.language || 'it'; return String(l).toLowerCase().indexOf('it') === 0 ? 'it' : 'en'; },
    missing: function () { return Object.keys(missing); },
    translateTree: translateTree
  };
})();
