/* =========================================================
   nduma — animazioni
   Tutto vanilla JS, nessuna libreria esterna.
   ========================================================= */

(function () {

  /* ---------- 1. Transizioni di pagina: slide direzionale ---------- */
  // Il bordo del telefono (.phone) non si muove mai: scorre solo .screen
  // (header + content). La direzione (sinistra/destra) dipende dalla posizione
  // delle due pagine nella navbar: si va "avanti" verso destra, "indietro" verso sinistra.
  var TAB_ORDER = ['index.html', 'eventi.html', 'crea.html', 'amici.html', 'profilo.html'];
  var STORAGE_KEY = 'cs-nav-direction';

  function currentFile() {
    var path = window.location.pathname;
    var file = path.substring(path.lastIndexOf('/') + 1);
    return file || 'index.html';
  }

  // Nome del file di destinazione, senza querystring: la maggior parte dei
  // link "veri" dell'app la usa (evento.html?id=..., crea.html?edit=...,
  // amico.html?token=..., profilo.html?mode=login...). Confrontare l'href
  // grezzo con TAB_ORDER falliva sempre per questi link, che quindi non
  // ricevevano né l'animazione di uscita né una direzione corretta in
  // entrata — la causa principale delle transizioni "sempre dallo stesso
  // lato" (Fil, 2026-07-10).
  function baseFile(href) {
    var q = href.indexOf('?');
    return q === -1 ? href : href.substring(0, q);
  }

  function resetScreen(screen) {
    screen.classList.remove('slide-out-left', 'slide-out-right', 'slide-in-from-left', 'slide-in-from-right', 'slide-in-active');
  }

  /* ---------- 0. Pallino indicatore nella navbar ---------- */
  // Un cerchietto che scorre orizzontalmente dietro l'icona attiva,
  // per far capire subito in che pagina ci si trova.
  var navIndicatorEl = null;

  function indicatorTargetX(navbar, item) {
    var navRect = navbar.getBoundingClientRect();
    var itemRect = item.getBoundingClientRect();
    var itemCenter = (itemRect.left - navRect.left) + itemRect.width / 2;
    return itemCenter - navIndicatorEl.offsetWidth / 2;
  }

  function moveNavIndicatorToItem(navbar, item, animate) {
    if (!navIndicatorEl) return;
    var x = indicatorTargetX(navbar, item);

    if (!animate) {
      navIndicatorEl.style.transition = 'none';
    }
    navIndicatorEl.style.transform = 'translateX(' + x + 'px)';

    if (!animate) {
      // forza il reflow prima di riattivare la transizione, altrimenti la riusa per lo spostamento
      navIndicatorEl.getBoundingClientRect();
      navIndicatorEl.style.transition = '';
    }
  }

  function initNavIndicator() {
    var navbar = document.querySelector('.navbar');
    if (!navbar) return;

    navIndicatorEl = document.createElement('div');
    navIndicatorEl.className = 'nav-indicator';
    navbar.insertBefore(navIndicatorEl, navbar.firstChild);

    var activeItem = navbar.querySelector('.nav-item.active') || navbar.querySelector('.nav-item');
    if (activeItem) {
      // posizionamento istantaneo al caricamento, nessuna animazione
      moveNavIndicatorToItem(navbar, activeItem, false);
    }

    window.addEventListener('resize', function () {
      var current = navbar.querySelector('.nav-item.active') || navbar.querySelector('.nav-item');
      if (current) moveNavIndicatorToItem(navbar, current, false);
    });
  }

  function initPageTransitions() {
    var screen = document.querySelector('.screen');
    if (!screen) return;

    // --- Entrata: applica lo slide-in nella direzione giusta ---
    var incoming = null;
    try { incoming = sessionStorage.getItem(STORAGE_KEY); } catch (err) { /* storage non disponibile */ }
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignora */ }

    resetScreen(screen);

    if (incoming === 'forward') {
      screen.classList.add('slide-in-from-right');
    } else if (incoming === 'backward') {
      screen.classList.add('slide-in-from-left');
    }

    // Doppio rAF: lascia che il browser applichi la posizione di partenza
    // (senza transizione) prima di attivare quella finale (con transizione).
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        screen.classList.remove('slide-in-from-right', 'slide-in-from-left');
        screen.classList.add('slide-in-active');
      });
    });

    // --- Uscita: al click su un link interno, scorre nella direzione giusta poi naviga ---
    // Selettore allargato a tutti gli "a[href]" (prima era "a[href$=\".html\"]",
    // che scartava in silenzio ogni link con querystring): il filtro vero e
    // proprio è sul nome file, non sull'href grezzo, così i link con "?"
    // vengono intercettati proprio come gli altri.
    document.querySelectorAll('a[href]').forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href || link.target === '_blank') return;

      var base = baseFile(href);
      if (base.slice(-5) !== '.html') return; // salta "#", mailto:, link esterni, ecc.

      link.addEventListener('click', function (e) {
        e.preventDefault();

        var current = currentFile();
        var curIdx = TAB_ORDER.indexOf(current);
        var destIdx = TAB_ORDER.indexOf(base);
        var isBack = link.classList.contains('back-btn');

        var direction;
        if (isBack) {
          direction = 'backward';
        } else if (curIdx !== -1 && destIdx !== -1) {
          direction = destIdx > curIdx ? 'forward' : 'backward';
        } else {
          direction = 'forward'; // es. da una card verso il dettaglio evento
        }

        try { sessionStorage.setItem(STORAGE_KEY, direction); } catch (err) { /* ignora */ }

        // Il pallino scorre subito verso la tab su cui hai cliccato, in parallelo allo slide
        if (link.classList.contains('nav-item') && !link.classList.contains('active')) {
          var navbarEl = link.closest('.navbar');
          if (navbarEl) moveNavIndicatorToItem(navbarEl, link, true);
        }

        screen.classList.remove('slide-in-active');
        screen.classList.add(direction === 'forward' ? 'slide-out-left' : 'slide-out-right');

        window.setTimeout(function () {
          window.location.href = href;
        }, 160);
      });
    });
  }

  /* ---------- 2. Effetto ripple ---------- */
  function initRipples() {
    var selector = '.card, .primary-btn, .chip, .pill, .nav-item .icon, .settings-row, .bell, .back-btn, .add-date-btn, .remove-date';

    document.querySelectorAll(selector).forEach(function (el) {
      // evita di ricollegare il listener se l'elemento era gia' stato inizializzato
      // (serve perche' questa funzione viene richiamata anche su contenuto aggiunto dopo il caricamento)
      if (el.dataset.rippleInit) return;
      el.dataset.rippleInit = '1';

      el.addEventListener('click', function (e) {
        var rect = el.getBoundingClientRect();
        var ripple = document.createElement('span');
        var size = Math.max(rect.width, rect.height) * 1.4;

        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';

        el.appendChild(ripple);
        ripple.addEventListener('animationend', function () {
          ripple.remove();
        });
      });
    });
  }

  /* ---------- 3. Barre di progresso + numeri animati ---------- */
  function animateCount(el, target, duration) {
    var start = 0;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      var value = Math.round(start + (target - start) * eased);
      el.textContent = value;

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        el.textContent = target;
      }
    }
    window.requestAnimationFrame(step);
  }

  function initProgressBars() {
    document.querySelectorAll('.progress-fill[data-progress]').forEach(function (fill) {
      // idem: non rianimare due volte una barra gia' processata
      if (fill.dataset.progressInit) return;
      fill.dataset.progressInit = '1';

      var target = fill.getAttribute('data-progress');
      var color = fill.getAttribute('data-color');

      fill.style.width = '0%';
      if (color) fill.style.background = color;

      var row = fill.closest('.progress-row');
      var countEl = row ? row.querySelector('.count-up') : null;
      var countTarget = countEl ? parseInt(countEl.getAttribute('data-target'), 10) : null;

      window.setTimeout(function () {
        fill.style.width = target + '%';
        if (countEl && !isNaN(countTarget)) {
          animateCount(countEl, countTarget, 900);
        }
      }, 300);
    });
  }

  /* ---------- 4. Reveal a scorrimento (IntersectionObserver) ----------
     IMPORTANTE: questa funzione viene richiamata ogni volta che una pagina
     genera contenuto dinamicamente (liste eventi, liste amici...), non solo
     al caricamento iniziale. Senza il filtro ":not([data-reveal-init])" le card
     create dopo il DOMContentLoaded (es. dopo una chiamata a Supabase) non
     venivano mai osservate e restavano invisibili per sempre (opacity:0),
     pur essendo presenti e cliccabili nel DOM. */
  function initScrollReveal() {
    var items = document.querySelectorAll('.reveal:not([data-reveal-init])');
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) {
        el.setAttribute('data-reveal-init', '1');
        el.classList.add('in-view');
      });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          var delay = parseInt(el.getAttribute('data-delay') || '0', 10);
          window.setTimeout(function () {
            el.classList.add('in-view');
          }, delay);
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.15 });

    items.forEach(function (el, i) {
      el.setAttribute('data-reveal-init', '1');
      el.setAttribute('data-delay', Math.min(i, 5) * 70);
      observer.observe(el);
    });
  }

  /* ---------- 5. Confetti per eventi confermati ---------- */
  function burstConfetti(originEl) {
    var phone = document.querySelector('.phone');
    if (!phone) return;

    var canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    var rect = phone.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    phone.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var colors = ['#FF7A29', '#6B3F73', '#FFB35C', '#9C6BA3', '#3D2244'];

    var originRect = originEl ? originEl.getBoundingClientRect() : rect;
    var originX = originRect.left - rect.left + originRect.width / 2;
    var originY = originRect.top - rect.top + 10;

    var particles = [];
    for (var i = 0; i < 40; i++) {
      particles.push({
        x: originX,
        y: originY,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * -6 - 2,
        size: Math.random() * 6 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        gravity: 0.25
      });
    }

    var start = null;
    function frame(timestamp) {
      if (!start) start = timestamp;
      var elapsed = timestamp - start;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(function (p) {
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      });

      if (elapsed < 1600) {
        window.requestAnimationFrame(frame);
      } else {
        canvas.remove();
      }
    }
    window.requestAnimationFrame(frame);
  }

  // Fil, 2026-07-19: "vedo i coriandoli ogni volta che cambio pagina" — il
  // controllo precedente (data-confetti-init sull'elemento DOM del badge)
  // non bastava perché ogni pagina ricostruisce il DOM da zero a ogni
  // render/navigazione: un badge "confermato" nuovo di zecca non ha mai
  // quell'attributo, quindi i coriandoli ripartivano su ogni pagina che
  // mostra quell'evento (Home, elenco eventi, dettaglio...). Ora si ricorda
  // per device, evento per evento, se li ha già visti: festeggia una volta
  // sola nella vita di quell'evento, non a ogni caricamento di pagina.
  var CONFETTI_SHOWN_KEY = 'nduma:confettiShown';

  function hasShownConfetti(eventId) {
    try {
      var raw = localStorage.getItem(CONFETTI_SHOWN_KEY);
      var shown = raw ? JSON.parse(raw) : [];
      return shown.indexOf(eventId) !== -1;
    } catch (err) { return false; }
  }

  function markConfettiShown(eventId) {
    try {
      var raw = localStorage.getItem(CONFETTI_SHOWN_KEY);
      var shown = raw ? JSON.parse(raw) : [];
      if (shown.indexOf(eventId) === -1) {
        shown.push(eventId);
        if (shown.length > 200) shown = shown.slice(shown.length - 200); // non deve crescere all'infinito
        localStorage.setItem(CONFETTI_SHOWN_KEY, JSON.stringify(shown));
      }
    } catch (err) { /* ignora: nel peggiore dei casi i coriandoli si rivedono */ }
  }

  function initConfetti() {
    var doneBadges = document.querySelectorAll('.badge.done[data-event-id]:not([data-confetti-init])');
    if (!doneBadges.length) return;

    doneBadges.forEach(function (b) { b.setAttribute('data-confetti-init', '1'); });

    // Il primo badge "confermato" di un evento MAI festeggiato prima su
    // questo device, per non esagerare anche quando ce n'è più di uno in
    // pagina (es. Home con più eventi confermati insieme).
    var toCelebrate = null;
    for (var i = 0; i < doneBadges.length; i++) {
      var eventId = doneBadges[i].getAttribute('data-event-id');
      if (eventId && !hasShownConfetti(eventId)) {
        toCelebrate = doneBadges[i];
        markConfettiShown(eventId);
        break;
      }
    }
    if (!toCelebrate) return;

    // Piccolo ritardo per farlo partire dopo l'entrata della card
    window.setTimeout(function () {
      burstConfetti(toCelebrate);
    }, 700);
  }

  /* ---------- 7. Data di oggi nell'header della Home ---------- */
  function initTodayDate() {
    var el = document.getElementById('todayDate');
    if (!el) return;

    try {
      var formatted = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
      el.textContent = 'Oggi, ' + formatted;
    } catch (err) {
      el.textContent = 'Oggi';
    }
  }

  /* ---------- 8. Badge presenza ----------
     Chi ha un account vede una frase calcolata sulle sue presenze vere agli
     ultimi eventi già conclusi (confermati o passati) a cui ha partecipato:
     "presente" vuol dire che, tra i giorni proposti, era disponibile proprio
     per quello poi confermato (bestOption) — è l'unico modo che abbiamo per
     dedurre "c'eri davvero", dato che l'app non fa un check-in reale.
     Chi non ha ancora un account non ha nessuna storia da mostrare: vede
     invece una frase buffa/ironica (scelta a caso ad ogni visita) che lo
     invita a registrarsi — cliccarla porta dritto al profilo. */
  var GUEST_ATTENDANCE_PHRASES = [
    '🕵️ Ospite misterioso: nessuno sa se ci sei mai stato',
    '👻 Account fantasma: 0 eventi, 0 gloria',
    '🎭 Stai partecipando in incognito',
    '🔮 La tua fama è ancora tutta da scrivere',
    '🍕 Ospite di passaggio: registrati e diventa leggenda'
  ];

  function showGuestAttendanceBadge(el) {
    el.textContent = GUEST_ATTENDANCE_PHRASES[Math.floor(Math.random() * GUEST_ATTENDANCE_PHRASES.length)];
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      window.location.href = 'profilo.html';
    });
  }

  async function showRealAttendanceBadge(el) {
    var guestName = NdumaData.getGuestName() || '';
    if (!guestName) return;
    var lower = guestName.toLowerCase();

    var events;
    try {
      events = await NdumaData.getEvents();
    } catch (err) {
      return;
    }

    // solo eventi davvero conclusi (confermati o passati), e solo quelli a cui
    // hai risposto in qualche modo (anche "non ci sono mai": conta come assenza,
    // non va escluso, altrimenti la statistica premierebbe chi ignora l'invito)
    var attended = events
      .map(function (e) { return { event: e, info: NdumaData.computeEventStatus(e) }; })
      .filter(function (x) { return x.info.status === 'done' || x.info.status === 'passato'; })
      .filter(function (x) {
        return (x.event.participants || []).some(function (p) { return p.name.toLowerCase() === lower; });
      });

    // i più recenti prima (le date ISO si ordinano bene anche come stringhe)
    attended.sort(function (a, b) {
      var va = a.info.bestOption ? a.info.bestOption.dateISO : '';
      var vb = b.info.bestOption ? b.info.bestOption.dateISO : '';
      return vb.localeCompare(va);
    });

    var recent = attended.slice(0, 5);
    if (!recent.length) {
      el.textContent = '✨ Ancora nessun evento concluso da valutare';
      return;
    }

    var presentCount = recent.filter(function (x) {
      var participant = (x.event.participants || []).filter(function (p) { return p.name.toLowerCase() === lower; })[0];
      var ids = participant ? (participant.availableDateOptionIds || []) : [];
      return x.info.bestOption && ids.indexOf(x.info.bestOption.id) !== -1;
    }).length;

    var total = recent.length;
    var ratio = presentCount / total;
    var phrase;
    if (ratio === 1) {
      phrase = '🔥 Presente a tutti gli ultimi ' + total + (total === 1 ? ' evento' : ' eventi');
    } else if (ratio === 0) {
      phrase = '👻 Assente agli ultimi ' + total + (total === 1 ? ' evento' : ' eventi');
    } else if (ratio >= 0.7) {
      phrase = '🌟 L\'anima della compagnia';
    } else if (ratio >= 0.4) {
      phrase = '🎉 Presente a ' + presentCount + ' eventi su ' + total;
    } else {
      phrase = '📉 Presenze in calo ultimamente...';
    }
    el.textContent = phrase;
  }

  function initAttendanceBadge() {
    var el = document.getElementById('attendanceBadge');
    if (!el || typeof NdumaData === 'undefined') return;

    if (!NdumaData.hasAccount()) {
      showGuestAttendanceBadge(el);
      return;
    }

    showRealAttendanceBadge(el);
  }

  /* ---------- 6. Chip: piccolo "pop" alla selezione ---------- */
  function initChipPop() {
    document.querySelectorAll('.chip').forEach(function (chip) {
      if (chip.dataset.chipPopInit) return;
      chip.dataset.chipPopInit = '1';

      chip.addEventListener('click', function () {
        chip.classList.add('pop');
        window.setTimeout(function () {
          chip.classList.remove('pop');
        }, 260);
      });
    });
  }

  /* ---------- 9.6 Popup dal basso (toast) ----------
     Usato ad esempio da amico.html: dopo aver confermato un invito, invece di
     restare sulla pagina invito rimbalza subito sulla Home, e qui appare questo
     popup con "Sei stato aggiunto come Marco alla lista di Fil", che sparisce
     da solo dopo qualche secondo.
     Il messaggio passa da una pagina all'altra tramite sessionStorage (visto che
     nel frattempo c'e' una navigazione vera): chi vuole mostrare un toast dopo
     aver mandato l'utente altrove chiama solo sessionStorage.setItem(TOAST_KEY, msg)
     prima di cambiare pagina; initPendingToast() (chiamata ad ogni caricamento)
     lo trova, lo consuma e lo mostra una volta sola. */
  var TOAST_KEY = 'nduma:toast';

  function showToast(message) {
    var phone = document.querySelector('.phone');
    if (!phone || !message) return;

    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    phone.appendChild(toast);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toast.classList.add('show');
      });
    });

    window.setTimeout(function () {
      toast.classList.remove('show');
      window.setTimeout(function () { toast.remove(); }, 320);
    }, 3200);
  }

  function initPendingToast() {
    var message;
    try {
      message = sessionStorage.getItem(TOAST_KEY);
      if (message) sessionStorage.removeItem(TOAST_KEY);
    } catch (err) {
      return;
    }
    if (message) showToast(message);
  }

  /* ---------- 9. Aggancio per contenuto dinamico ----------
     Le pagine (amici.html, eventi.html, index.html, profilo.html, evento.html)
     generano card/liste DOPO il caricamento iniziale (quando arrivano i dati
     da Supabase). Vanno richiamate qui le stesse inizializzazioni di animazione,
     altrimenti quel contenuto resta invisibile o senza le interazioni (ripple,
     barre di progresso, reveal...). Ogni funzione qui sopra e' scritta per essere
     "idempotente": si puo' richiamare piu' volte senza ridoppiare listener o rianimare
     due volte lo stesso elemento. */
  function refreshDynamicContent() {
    initRipples();
    initProgressBars();
    initScrollReveal();
    initConfetti();
    initChipPop();
    initRepeatShortcuts();
  }

  /* ---------- scorciatoia "Ripeti" sulla card di un evento annullato ----------
     Fil, 2026-07-10: prima "Ripeti questo evento" viveva solo dentro il
     dettaglio (evento.html); questo bottone compare direttamente sulla card
     in Home/Eventi/Profilo (vedi NdumaData.renderEventCardHTML) per chi
     l'ha organizzato. La card è un <a> che punta al dettaglio: preventDefault
     + stopPropagation fermano quel click prima che apra l'evento, poi si
     ricostruisce la stessa bozza che usava il bottone dentro evento.html e
     si passa a crea.html. */
  function initRepeatShortcuts() {
    document.querySelectorAll('[data-repeat-event]:not([data-repeat-init])').forEach(function (btn) {
      btn.setAttribute('data-repeat-init', '1');

      btn.addEventListener('click', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!window.NdumaData) return;

        var eventId = btn.getAttribute('data-repeat-event');
        var originalText = btn.textContent;
        btn.textContent = 'Preparo...';

        var ev;
        try {
          ev = await NdumaData.getEventById(eventId);
        } catch (err) {
          btn.textContent = originalText;
          return;
        }
        if (!ev) { btn.textContent = originalText; return; }

        var repeatDraft = {
          eventName: ev.name,
          description: ev.description,
          locationValue: ev.locationAddress || '',
          selectedLocation: {
            address: ev.locationAddress || null,
            placeId: ev.locationPlaceId || null,
            lat: (ev.locationLat === undefined) ? null : ev.locationLat,
            lng: (ev.locationLng === undefined) ? null : ev.locationLng
          },
          carriedPhotoUrl: ev.photoUrl || null,
          currentStep: 1
        };
        try {
          sessionStorage.setItem('nduma:eventDraft', JSON.stringify(repeatDraft));
          sessionStorage.setItem('cs-nav-direction', 'forward');
        } catch (err) { /* ignora: nel peggiore dei casi si riparte da un form vuoto */ }

        window.location.href = 'crea.html';
      });
    });
  }

  /* ---------- 9.7 Navbar che sparisce quando si apre la tastiera ----------
     La navbar e' "position: absolute" ancorata al bordo di .phone: su iOS,
     quando si apre la tastiera, il browser scrolla per portare il campo
     attivo in vista ma .phone (alto 100dvh) non si restringe di conseguenza,
     quindi la navbar finisce ancorata a un "fondo" che non e' piu' quello
     visibile — appare storta/a meta' schermo invece che in fondo. Piu'
     semplice farla sparire del tutto mentre scrivi (ci lascia anche piu'
     spazio utile) che inseguire il comportamento della tastiera. */
  function initKeyboardAwareNavbar() {
    var FOCUSABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

    document.addEventListener('focusin', function (e) {
      if (FOCUSABLE_TAGS.indexOf(e.target.tagName) === -1) return;
      var navbar = document.querySelector('.navbar');
      if (navbar) navbar.classList.add('navbar-hidden');
    });

    document.addEventListener('focusout', function (e) {
      if (FOCUSABLE_TAGS.indexOf(e.target.tagName) === -1) return;
      // piccolo ritardo: se il focus passa subito a un altro campo (es. Tab
      // tra due input) non deve ricomparire e sparire di nuovo a scatti
      window.setTimeout(function () {
        var active = document.activeElement;
        if (active && FOCUSABLE_TAGS.indexOf(active.tagName) !== -1) return;
        var navbar = document.querySelector('.navbar');
        if (navbar) navbar.classList.remove('navbar-hidden');
      }, 80);
    });
  }

  /* ---------- splash screen "veramente breve" alla prima apertura ----------
     Solo in Home (l'unica pagina con #splashScreen nell'HTML — le altre non
     ce l'hanno, quindi qui non fanno nulla), e solo quando sono passate
     alcune ore dall'ultima volta: un piccolo script inline in cima a
     index.html ha già deciso se nasconderla subito (senza flash, prima che
     il resto della pagina sia dipinto); se invece è ancora visibile qui,
     significa che va mostrata davvero, quindi la teniamo un attimo e la
     facciamo sparire con una dissolvenza, salvando il momento in cui è
     successo. Fil: "solo per estetica", quindi durata volutamente breve. */
  function initSplashScreen() {
    var splash = document.getElementById('splashScreen');
    if (!splash) return;

    var isVisible = splash.style.display !== 'none';
    if (!isVisible) return; // già nascosta dallo script inline: nulla da fare

    window.setTimeout(function () {
      splash.classList.add('splash-hidden');
      window.setTimeout(function () { splash.style.display = 'none'; }, 400);
    }, 550);

    try { localStorage.setItem('nduma:splashLastShown', String(Date.now())); } catch (err) { /* ignora */ }
  }

  /* ---------- suggerimento "Aggiungi alla schermata Home" per iPhone/iPad ----------
     Android/Chrome mostra da solo un banner di installazione (mini-infobar)
     quando il sito ha un manifest.json valido — vedi manifest.json + le icone
     icon-192.png/icon-512.png/apple-touch-icon.png in questa cartella, e i tag
     nell'head di ogni pagina. iOS/Safari invece non ha mai avuto un banner
     automatico (Apple non implementa l'evento che lo farebbe scattare): qui
     ne costruiamo uno nostro, solo in Home, solo su iPhone/iPad, solo se il
     sito non è già aperto come app aggiunta alla Home, e solo se non è già
     stato chiuso in passato (non deve tornare a infastidire ogni volta). */
  function initIosInstallHint() {
    var mount = document.querySelector('.content');
    if (!mount) return;

    var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    if (!isIos) return;

    if (window.navigator.standalone) return; // già aggiunta alla Home

    // Niente banner finché non c'è un account: su chi deve ancora registrarsi
    // (passaggio obbligatorio) non ha senso proporre di installare l'app
    // prima ancora che possa usarla (Fil, 2026-07-10).
    if (window.NdumaData && typeof NdumaData.hasAccount === 'function' && !NdumaData.hasAccount()) return;

    var dismissed;
    try { dismissed = localStorage.getItem('nduma:iosInstallHintDismissed'); } catch (err) { dismissed = null; }
    if (dismissed) return;

    var hint = document.createElement('div');
    hint.className = 'install-hint';
    hint.innerHTML = ''
      + '<div>📲 Aggiungi nduma alla schermata Home: tocca <b>Condividi</b> ⬆️, poi <b>"Aggiungi alla schermata Home"</b>.</div>'
      + '<div class="dismiss" id="installHintDismiss">✕</div>';
    mount.insertBefore(hint, mount.firstChild);

    function dismissInstallHint() {
      if (hint.parentNode) hint.remove();
      try { localStorage.setItem('nduma:iosInstallHintDismissed', '1'); } catch (err) { /* ignora */ }
    }

    var dismissBtn = document.getElementById('installHintDismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', dismissInstallHint);
    }

    // Sparisce da solo dopo 8s per chi non è interessato a installarla: non
    // deve restare a occupare spazio in cima al contenuto (Fil, 2026-07-10).
    window.setTimeout(dismissInstallHint, 8000);
  }

  /* ---------- suggerimenti account (username + foto) su un input testuale ----------
     Fil, 2026-07-07, dopo il documento "ci-siamo-omonimi.pdf": invece di
     collegare un nome scritto a mano a un account "alla cieca" (solo perché
     il testo combacia), qui si cerca tra gli account registrati mentre
     digiti e si conferma con un click, vedendo username + foto. Agganciabile
     a qualunque input (usato in amici.html per aggiungere un amico a una
     lista, e in crea.html per gli invitati scritti a mano).

     Il collegamento scelto si legge da chi chiama tramite
     inputEl.dataset.linkedAccountId — resta valido solo finché il testo
     dell'input combacia esattamente con lo username scelto (stesso principio
     dell'autocompletamento posizione già in crea.html: se modifichi il testo
     dopo aver scelto un suggerimento, quel collegamento non è più affidabile
     e si annulla da solo). Se non scegli nessun suggerimento, il nome resta
     "libero" come è sempre stato — Fil ha confermato che deve restare
     sempre possibile, per chi non ha ancora un account su nduma. */
  function attachAccountSearch(inputEl, onSelect) {
    if (!inputEl || !window.NdumaData || typeof NdumaData.searchAccounts !== 'function') return null;

    var parent = inputEl.parentElement;
    if (parent && window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    var dropdown = document.createElement('div');
    dropdown.className = 'account-search-dropdown';
    dropdown.style.display = 'none';
    if (parent) parent.appendChild(dropdown);

    var debounceTimer = null;
    var lastQuery = '';
    var lastResults = [];

    function clearLink() {
      delete inputEl.dataset.linkedAccountId;
      delete inputEl.dataset.linkedUsername;
      delete inputEl.dataset.linkedAvatarUrl;
    }

    function hideDropdown() {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    }

    // Fil, 2026-07-19: prima non c'era nessun segnale tra "smetto di
    // scrivere" e "spuntano i risultati" — su una rete lenta (iPhone in
    // mobilità, vedi anche la compressione foto aggiunta oggi) il campo
    // sembrava morto per un attimo. Copre sia l'attesa del debounce (250ms)
    // sia quella della rete: sparisce da sola appena renderResults() o
    // hideDropdown() sovrascrivono il contenuto del dropdown.
    function showLoading() {
      dropdown.innerHTML = '<div class="account-search-loading"><span class="account-search-spinner"></span></div>';
      dropdown.style.display = '';
    }

    function renderResults(results) {
      lastResults = results || [];

      if (!lastResults.length) {
        // Fil, 2026-07-19: prima spariva tutto in silenzio, come se non
        // fosse successo nulla — chi cercava un amico non capiva se non
        // l'aveva trovato perché non è registrato su nduma, o se la
        // ricerca semplicemente non era ancora partita. Il nome resta
        // comunque valido come invitato "libero" (senza account collegato,
        // vedi commento in cima al file): questo è solo per chiarire perché
        // non compare nessun suggerimento da scegliere.
        dropdown.innerHTML = '<div class="account-search-empty">Nessun account trovato con questo nome</div>';
      } else {
        dropdown.innerHTML = lastResults.map(function (acc) {
          var initial = (acc.username.trim().charAt(0) || '?').toUpperCase();
          var circle = acc.avatarUrl
            ? '<img src="' + NdumaData.escapeHTML(acc.avatarUrl) + '" alt="">'
            : NdumaData.escapeHTML(initial);
          return ''
            + '<div class="account-search-item" data-account-id="' + acc.id + '" data-username="' + NdumaData.escapeHTML(acc.username) + '" data-avatar-url="' + NdumaData.escapeHTML(acc.avatarUrl || '') + '">'
            + '<div class="account-search-avatar">' + circle + '</div>'
            + '<div>' + NdumaData.escapeHTML(acc.username) + '</div>'
            + '</div>';
        }).join('');
      }
      dropdown.style.display = '';

      // Fil, 2026-07-19: in amici.html il campo sta in cima al popup (fix
      // precedente) e lì i risultati hanno sempre spazio, ma in crea.html lo
      // stesso identico componente vive a metà della pagina di creazione
      // evento — con la tastiera aperta i risultati potevano finire coperti,
      // perché lo scroll automatico del telefono avviene al focus (per
      // mostrare il campo) e non si ripete quando il dropdown compare dopo,
      // mentre scrivi. Fix qui invece che pagina per pagina, così vale
      // ovunque venga usato attachAccountSearch, anche in futuro: ogni volta
      // che i risultati compaiono/cambiano, si porta il dropdown dentro
      // l'area visibile — sul telefono questo tiene conto anche della
      // tastiera aperta, non solo dello scroll della pagina.
      window.requestAnimationFrame(function () {
        dropdown.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }

    // Interroga il server SUBITO (non aspetta il debounce): usata sia dal
    // digitare normale sotto, sia da flush() più in basso — chi preme
    // "+"/Invio prima che il debounce sia scattato non deve mai aspettare
    // più del necessario (Fil, 2026-07-13).
    function runSearch(query) {
      lastQuery = query;
      var p = NdumaData.searchAccounts(query).then(function (results) {
        if (query !== lastQuery) return lastResults; // superata da una ricerca più recente
        renderResults(results);
        return results;
      }).catch(function () {
        hideDropdown();
        return [];
      });
      return p;
    }

    inputEl.addEventListener('input', function () {
      if (inputEl.dataset.linkedUsername && inputEl.value !== inputEl.dataset.linkedUsername) {
        clearLink();
      }

      var query = inputEl.value.trim();
      window.clearTimeout(debounceTimer);
      if (query.length < 2) { hideDropdown(); lastQuery = query; return; }

      showLoading();
      debounceTimer = window.setTimeout(function () { runSearch(query); }, 250);
    });

    // mousedown (non click) per battere il blur dell'input qui sotto, che
    // altrimenti nasconderebbe il dropdown prima che il tap venga registrato
    dropdown.addEventListener('mousedown', function (e) {
      var item = e.target.closest('.account-search-item');
      if (!item) return;
      e.preventDefault();
      inputEl.value = item.getAttribute('data-username');
      inputEl.dataset.linkedAccountId = item.getAttribute('data-account-id');
      inputEl.dataset.linkedUsername = item.getAttribute('data-username');
      inputEl.dataset.linkedAvatarUrl = item.getAttribute('data-avatar-url') || '';
      hideDropdown();

      // Un click su un profilo trovato vale già come conferma: non deve
      // servire un secondo tocco su "+" (Fil, 2026-07-10). Chi chiama passa
      // la propria funzione "aggiungi" (stessa usata dal bottone/Enter),
      // qui semplicemente la richiamiamo subito dopo aver riempito il campo.
      if (typeof onSelect === 'function') onSelect();
    });

    inputEl.addEventListener('blur', function () {
      window.setTimeout(hideDropdown, 150);
    });

    // fumetto "cos'è questa ricerca" al primo focus, una sola volta per
    // dispositivo: stessa chiave per amici.html e crea.html, è lo stesso
    // concetto in entrambi i posti (vedi showOnceHint sotto). Il contenitore
    // per il fumetto NON è lo stesso di "parent" usato sopra per il dropdown
    // (quello deve restare la riga input+bottone, stretta): qui serve un
    // blocco più largo, tipicamente il campo ".field" che lo racchiude.
    // Sparisce da solo appena scrivi qualcosa (o esci dal campo): niente ✕.
    inputEl.addEventListener('focus', function () {
      var hintContainer = inputEl.closest('.field')
        || (inputEl.closest('.inline-add-row') && inputEl.closest('.inline-add-row').parentElement)
        || parent;
      showOnceHint('accountSearch', hintContainer, 'Cerca per nome utente o per nome e cognome: se la trovi e la scegli, resta collegata per sempre e riceverà notifiche vere invece di un invito generico.', inputEl, ['input', 'blur']);
    });

    /* Da richiamare prima di aggiungere (Invio o "+"): se per il testo
       attuale la ricerca è ancora ferma nel debounce, la lancia subito e
       aspetta il risultato — così chi scrive veloce e preme subito Invio
       non aggiunge mai un nome "a vuoto" quando quella persona è già
       registrata (Fil, 2026-07-13, dopo aver visto che scrivendo "Filippo"
       di getto il suggerimento non faceva in tempo a comparire). Se il
       nome scritto combacia esattamente con un account trovato, lo collega
       da solo, come un click sul suggerimento. */
    function flush() {
      var query = inputEl.value.trim();
      if (query.length < 2) { hideDropdown(); return Promise.resolve(); }
      if (inputEl.dataset.linkedUsername === inputEl.value) { hideDropdown(); return Promise.resolve(); } // già collegato, niente da aspettare

      window.clearTimeout(debounceTimer);
      return runSearch(query).then(function (results) {
        var exact = (results || []).filter(function (acc) {
          return acc.username.toLowerCase() === query.toLowerCase();
        })[0];
        if (exact) {
          inputEl.value = exact.username;
          inputEl.dataset.linkedAccountId = exact.id;
          inputEl.dataset.linkedUsername = exact.username;
          inputEl.dataset.linkedAvatarUrl = exact.avatarUrl || '';
        }
        // La si nasconde sempre a questo punto (trovato o no): chi ha
        // premuto "+"/Invio sta commettendo l'aggiunta adesso, un
        // suggerimento rimasto visibile dopo sembra un'azione ancora da
        // fare quando invece è già stato deciso tutto (Fil, 2026-07-13,
        // dopo aver visto il suggerimento restare a schermo e pensato che
        // il nome non fosse stato aggiunto).
        hideDropdown();
      });
    }

    return { flush: flush };
  }

  /* ---------- fumetto informativo "una volta sola" ----------
     Fil, 2026-07-07: niente tour a schermate (troppo invasivo per un'app tra
     amici), solo un fumettino piccolo agganciato al campo giusto. Niente ✕
     (Fil, stesso giorno, dopo aver visto la prima versione: "mi sa troppo di
     banner"): sparisce da solo quando interagisci col campo a cui si
     riferisce (dismissTriggerEl + dismissEvents), non prima, e non torna più
     su quel dispositivo (localStorage). Se passato, onDismissed fa comparire
     il fumetto successivo solo DOPO che hai chiuso questo — così, su un form
     con più campi, li vedi in sequenza invece che tutti insieme.
     storageKey identifica IL CONCETTO spiegato, non la pagina: due punti
     diversi dell'app che spiegano la stessa cosa (es. la ricerca account in
     amici.html e crea.html) condividono la stessa chiave, così non lo
     rispieghi due volte alla stessa persona.
     Ritorna true se il fumetto è stato davvero mostrato (falso se già visto
     in passato, o se ne stavo già mostrando uno identico) — comodo per chi
     chiama in catena: se questo non si mostra, si passa subito al prossimo. */
  function showOnceHint(storageKey, containerEl, text, dismissTriggerEl, dismissEvents, onDismissed) {
    if (!containerEl || !text) return false;
    var fullKey = 'nduma:hintSeen:' + storageKey;
    try {
      if (localStorage.getItem(fullKey)) return false;
    } catch (e) { return false; }

    // già mostrato in questa stessa sessione di navigazione (es. sei tornato
    // allo step 2 avanti e indietro prima di chiuderlo): non raddoppiare
    if (containerEl.querySelector('.hint-bubble')) return false;

    var bubble = document.createElement('div');
    bubble.className = 'hint-bubble';
    bubble.textContent = text;
    containerEl.appendChild(bubble);

    var events = dismissEvents && dismissEvents.length ? dismissEvents : ['focus', 'click', 'change'];

    function dismiss() {
      try { localStorage.setItem(fullKey, '1'); } catch (e) { /* ignora */ }
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
      if (dismissTriggerEl) {
        events.forEach(function (evt) { dismissTriggerEl.removeEventListener(evt, dismiss); });
      }
      if (typeof onDismissed === 'function') onDismissed();
    }

    if (dismissTriggerEl) {
      events.forEach(function (evt) { dismissTriggerEl.addEventListener(evt, dismiss); });
    }
    return true;
  }

  /* Popup "Attiva le notifiche", proposto attivamente a chi si registra o fa
     login (solo nell'app da Home schermo, vedi NdumaData.shouldOfferPushPrompt)
     -- Fil, 2026-07-19: "sono molto importanti per noi". Stesso stile visivo
     del popup "serve un profilo" (.signup-overlay/.signup-modal), sopra il
     contenuto della pagina corrente. Ritorna una Promise che si risolve
     quando il popup si chiude (attivate o "Non ora"), così chi chiama può
     aspettarlo prima di navigare altrove. */
  function showPushPrompt() {
    return new Promise(function (resolve) {
      var screenEl = document.querySelector('.screen');
      if (!screenEl) { resolve(); return; }

      var overlay = document.createElement('div');
      overlay.className = 'signup-overlay';
      overlay.innerHTML = ''
        + '<div class="signup-modal">'
        + '<div class="signup-modal-icon">🔔</div>'
        + '<div class="signup-modal-title">Attiva le notifiche</div>'
        + '<div class="signup-modal-text">Ti avvisiamo quando qualcuno ti invita, conferma o cambia un evento — senza dover controllare l\'app di continuo.</div>'
        + '<button type="button" class="primary-btn" id="pushPromptEnableBtn" style="width:100%;">Attiva notifiche</button>'
        + '<a class="signup-skip-link" id="pushPromptSkipLink">Non ora</a>'
        + '</div>';
      screenEl.appendChild(overlay);

      function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve();
      }

      var enableBtn = overlay.querySelector('#pushPromptEnableBtn');
      var skipLink = overlay.querySelector('#pushPromptSkipLink');

      enableBtn.addEventListener('click', async function () {
        enableBtn.disabled = true;
        enableBtn.textContent = 'Attivo...';
        try {
          await window.NdumaData.subscribeToPush();
          showToast('Notifiche attivate! 🔔');
        } catch (err) {
          // Permesso negato dal browser o errore: niente da fare qui, si
          // può sempre riattivare dal Profilo in un secondo momento.
        }
        close();
      });

      skipLink.addEventListener('click', function (e) {
        e.preventDefault();
        close();
      });
    });
  }

  // Punto unico da chiamare dopo login/registrazione: controlla da solo se
  // ha senso proporre le notifiche (vedi shouldOfferPushPrompt in data.js) e
  // mostra il popup solo se sì -- chi chiama non deve sapere altro.
  async function offerPushPromptIfNeeded() {
    if (!window.NdumaData || typeof window.NdumaData.shouldOfferPushPrompt !== 'function') return;
    var should = false;
    try {
      should = await window.NdumaData.shouldOfferPushPrompt();
    } catch (err) { return; }
    if (!should) return;
    await showPushPrompt();
  }

  window.NdumaUI = {
    refresh: refreshDynamicContent,
    toast: showToast,
    attachAccountSearch: attachAccountSearch,
    showOnceHint: showOnceHint,
    offerPushPromptIfNeeded: offerPushPromptIfNeeded
  };

  document.addEventListener('DOMContentLoaded', function () {
    initNavIndicator();
    initPageTransitions();
    initRipples();
    initProgressBars();
    initScrollReveal();
    initConfetti();
    initChipPop();
    initRepeatShortcuts();
    initTodayDate();
    initAttendanceBadge();
    initPendingToast();
    initKeyboardAwareNavbar();
    initSplashScreen();
    initIosInstallHint();
  });

  // Gestisce il tasto "indietro" del browser (bfcache): la pagina torna dalla cache
  // già con le vecchie classi di transizione, quindi la rimettiamo a posto di scatto.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      var screen = document.querySelector('.screen');
      if (screen) {
        resetScreen(screen);
        screen.classList.add('slide-in-active');
      }
    }
  });

})();
