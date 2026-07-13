/* =========================================================
   Ci siamo — livello dati.
   Ora parla con Supabase (Postgres reale) invece che con localStorage:
   eventi, liste amici, partecipanti sono condivisi davvero tra chi apre
   il link. Login/password passano dal vero Supabase Auth (auth.users), non
   più da una tabella fatta in casa: creazione account via Edge Function
   "create-account" (Admin API), login via supabase.auth.signInWithPassword().
   La tabella "accounts" resta il profilo pubblico (username, nome, avatar…),
   raggiungibile solo da get_own_account/update_account (SECURITY DEFINER,
   usano auth.uid() — mai un id passato dal client).
   Serve un browser che supporti async/await (qualunque browser moderno).
   ========================================================= */

(function (global) {

  var SUPABASE_URL = 'https://kruphqdahghxuvutonae.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_WU-op4b5mEoqOZpzOYFSaA_P5ElM1y_';
  var supabase = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  /* Chiave per Google Maps (Places Autocomplete, usata da crea.html per il
     campo posizione). È normale che sia visibile qui: le chiavi Maps sono
     fatte per stare lato client, e si proteggono restringendo i referrer
     HTTP consentiti dalla Google Cloud Console, non tenendole segrete.
     Finché resta vuota, il campo posizione si disattiva da solo (vedi
     crea.html) invece di rompersi. */
  var GOOGLE_MAPS_API_KEY = 'AIzaSyDxpmS5OTFUdC5SnQio15gaWvXBELrw45Q';

  var GUEST_KEY = 'ci-siamo:guestName';
  var ACCOUNT_KEY = 'ci-siamo:account'; // cache locale minima: { id, username, avatarUrl }, mai la password
  var GUEST_LOCK_KEY = 'ci-siamo:guestLock'; // { type: 'event'|'list', id, name?, ownerName? }

  /* ---------- utility di base ---------- */

  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* localStorage non disponibile (es. modalità privata): pazienza, si perde solo la persistenza locale */
    }
  }

  function formatDateLabel(dateISO) {
    try {
      var d = new Date(dateISO + 'T00:00:00');
      var withDay = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
      return withDay.charAt(0).toUpperCase() + withDay.slice(1);
    } catch (err) {
      return dateISO;
    }
  }

  function shortDateLabel(dateISO) {
    try {
      var d = new Date(dateISO + 'T00:00:00');
      return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
    } catch (err) {
      return dateISO;
    }
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /* ---------- profilo/account ----------
     Il dispositivo tiene in cache solo { id, username }: basta per sapere
     "chi sono su questo telefono" senza rifare query inutili. Tutto il resto
     (nome, cognome, email, data di nascita) si legge on-demand da Supabase
     con fetchOwnAccount(), e non viene mai salvato in chiaro qui. */

  function getAccount() {
    return readJSON(ACCOUNT_KEY, null);
  }

  function saveAccountLocal(acc) {
    writeJSON(ACCOUNT_KEY, acc);
  }

  function hasAccount() {
    var acc = getAccount();
    return !!(acc && acc.id && acc.username);
  }

  /* Se il database viene resettato (capita spesso in questa fase di sviluppo/
     test, vedi i vari TRUNCATE fatti a mano) l'account salvato sul telefono
     può restare "orfano": esiste ancora in locale ma il suo id non esiste più
     lato server. La prima volta che questo dispositivo prova a scrivere
     qualcosa legato all'account (creare una lista amici, collegare un account
     a un amico invitato...) Postgres rifiuta con una foreign key violation.
     Le uniche due tabelle con una FK verso accounts sono friend_lists
     (owner_account_id) e friends (account_id): il messaggio d'errore Postgres
     contiene sempre "..._account_id_fkey" in questi casi, quindi lo
     riconosciamo da lì, puliamo l'account orfano in locale e trasformiamo
     l'errore tecnico in un messaggio comprensibile — invece di lasciar
     passare fino all'utente un testo tipo "violates foreign key constraint
     friend_lists_owner_account_id_fkey" (successo reale il 2026-07-05).
     Ogni chiamata Supabase che può toccare quelle due colonne dovrebbe passare
     il suo errore da qui invece di fare "throw new Error(res.error.message)"
     direttamente. */
  function throwSupabaseError(error) {
    var message = (error && error.message) || 'Errore sconosciuto';
    if (message.indexOf('account_id_fkey') !== -1) {
      try {
        window.localStorage.removeItem(ACCOUNT_KEY);
        window.localStorage.removeItem(GUEST_KEY);
      } catch (err) { /* ignora */ }
      throw new Error('Il profilo salvato su questo telefono non esiste più lato server (probabile reset del database in fase di test). Vai su Profilo e accedi di nuovo con la tua email, poi riprova.');
    }
    throw new Error(message);
  }

  /* ---------- "blocco" per chi continua senza account da un link di invito ----------
     Fil: entrare direttamente sul sito (digitando l'indirizzo) deve richiedere
     un account; "continua senza login" resta possibile SOLO passando da un
     link di invito (evento o lista amici), e in quel caso chi lo usa resta
     confinato solo a quell'evento o a quella lista — niente navbar, niente
     giro libero per il resto dell'app, finché non si registra (o accede).
     Il lock è persistente (localStorage, non sessionStorage): resta valido
     anche riaprendo il browser, finché non si crea/si entra in un account
     (vedi clearGuestLock, chiamato da createAccount/loginAccount/resetPassword). */
  function setGuestLock(lock) {
    writeJSON(GUEST_LOCK_KEY, lock);
  }

  function getGuestLock() {
    return readJSON(GUEST_LOCK_KEY, null);
  }

  function clearGuestLock() {
    try { window.localStorage.removeItem(GUEST_LOCK_KEY); } catch (err) { /* ignora */ }
  }

  /* Ogni pagina chiama questo all'inizio per sapere cosa fare:
     - { action: 'allow' }       → hai un account, nessuna restrizione
     - { action: 'allowLocked' } → sei un ospite bloccato, ma sei nel posto
                                    giusto (context combacia col lock): la
                                    pagina deve nascondere navbar/freccia
                                    indietro e offrire un modo di registrarsi
     - { action: 'redirect', url } → sei un ospite bloccato altrove: rimanda lì
     - { action: 'block' }       → nessun account e nessun lock attivo: sei
                                    arrivato "dal nulla", serve un profilo
     "context" è null per le pagine che non sono mai un posto consentito per
     un ospite bloccato (Home, Eventi, Notifiche, Crea, Amici); solo evento.html
     passa { type: 'event', id }. lista-invito.html non passa nulla: legge da
     sola il lock con getGuestLock(). */
  function checkAccessGate(context) {
    if (hasAccount()) return { action: 'allow' };

    var lock = getGuestLock();
    if (!lock) return { action: 'block' };

    if (context && context.type === lock.type && context.id === lock.id) {
      return { action: 'allowLocked' };
    }

    if (lock.type === 'event') {
      return { action: 'redirect', url: 'evento.html?id=' + encodeURIComponent(lock.id) };
    }
    return { action: 'redirect', url: 'lista-invito.html' };
  }

  /* Dal login vero con Supabase Auth (2026-07-12) in poi, "sei loggato" non
     è più solo la cache locale { id, username } (quella esisteva già prima,
     con l'account fatto in casa) — serve anche una sessione Supabase vera
     dietro, altrimenti auth.uid() è null per ogni richiesta e le RLS
     restituiscono zero righe IN SILENZIO, senza errore: sembra che l'app
     sia vuota invece di dire che non sei più autenticato. Successo davvero
     il 2026-07-12 con l'account creato la mattina prima della migrazione:
     cache locale presente, zero sessioni Supabase mai aperte per quell'id.
     Ogni pagina protetta chiama questo, oltre a checkAccessGate, per
     accorgersene ed evitare di mostrare una Home/Eventi vuoti senza
     spiegazione. Non tocca la cache locale da sola: mostrare il perché e
     lasciare a chi usa l'app la scelta di uscire (vedi logOut sotto). */
  async function checkSessionHealth() {
    if (!hasAccount()) return { ok: true };
    var acc = getAccount();
    var sessionRes = await supabase.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session;
    if (session && session.user && session.user.id === acc.id) return { ok: true };
    return { ok: false };
  }

  /* Uscita vera: chiude la sessione Supabase (non solo la cache locale, che
     da sola lascerebbe comunque valido il token sul dispositivo) e pulisce
     tutto quello che dice "sei loggato/sei un ospite con un nome" su questo
     telefono. Usata sia dal pulsante "Esci" in Profilo sia dall'avviso di
     sessione scaduta qui sopra. */
  async function logOut() {
    try { await supabase.auth.signOut(); } catch (err) { /* usciamo comunque in locale */ }
    try {
      window.localStorage.removeItem(ACCOUNT_KEY);
      window.localStorage.removeItem(GUEST_KEY);
    } catch (err) { /* ignora */ }
  }

  /* Inserisce l'avviso "sessione scaduta" in cima a containerEl se serve
     (vedi checkSessionHealth sopra) — volutamente qui in data.js e non in
     script.js: data.js è sempre il primo script caricato su ogni pagina
     (script.js è l'ultimo tag prima di </body>), quindi è l'unico posto da
     cui si può richiamare in modo affidabile nella parte sincrona
     dell'inizializzazione di una pagina, prima che sia garantito che
     script.js abbia già finito di caricarsi. Ogni pagina protetta la
     richiama subito dopo checkAccessGate; non fa nulla se non serve. */
  async function renderSessionWarningIfNeeded(containerEl) {
    var health;
    try { health = await checkSessionHealth(); } catch (err) { return; }
    if (health.ok) return;

    var target = containerEl || document.querySelector('.content');
    if (!target || target.querySelector('.session-warning-banner')) return;

    var banner = document.createElement('div');
    banner.className = 'session-warning-banner';
    banner.innerHTML = ''
      + '<div>Il tuo accesso su questo telefono non è più valido (è successo dopo un aggiornamento dell\'app): esci e accedi di nuovo per rivedere i tuoi dati.</div>'
      + '<button type="button" class="session-warning-btn">Esci ora</button>';
    target.insertBefore(banner, target.firstChild);

    banner.querySelector('.session-warning-btn').addEventListener('click', async function () {
      var btn = banner.querySelector('.session-warning-btn');
      btn.disabled = true;
      btn.textContent = 'Esco...';
      await logOut();
      window.location.href = 'profilo.html';
    });
  }

  /* Schermata "serve un profilo", uguale ovunque serva bloccare una pagina
     intera: stesso stile del popup di registrazione, solo non saltabile. */
  function accountRequiredBlockHTML(message) {
    return ''
      + '<div style="text-align:center; padding: 40px 12px;">'
      + '<div class="signup-modal-icon">🔒</div>'
      + '<div class="signup-modal-title">Serve un profilo</div>'
      + '<div class="signup-modal-text">' + escapeHTML(message || 'Per usare Ci siamo devi prima creare un profilo: ti basta un nome utente, si fa in un minuto.') + '</div>'
      + '<a class="primary-btn" href="profilo.html" style="display:block; text-decoration:none;">Crea il tuo profilo →</a>'
      + '<a class="signup-skip-link" href="profilo.html?mode=login" style="text-decoration:underline;">Hai già un account? Accedi</a>'
      + '</div>';
  }

  /* ---------- nome pubblico (identità senza vero login) ---------- */

  function getGuestName() {
    var acc = getAccount();
    if (acc && acc.username) return acc.username;
    return readJSON(GUEST_KEY, null);
  }

  function setGuestName(name) {
    // Aggiorna solo la cache locale (comodo per i campi "come ti chiami" sparsi
    // nell'app). Per rinominare davvero un account esistente su Supabase, e far
    // rispettare l'unicità dello username, usare updateAccount().
    var trimmed = (name || '').trim();
    var acc = getAccount();
    if (acc && acc.id) {
      acc.username = trimmed;
      saveAccountLocal(acc);
    } else {
      writeJSON(GUEST_KEY, trimmed);
    }
  }

  /* Legge il messaggio d'errore da una Edge Function invocata con
     supabase.functions.invoke(): a differenza di un rpc(), l'errore non ha
     .message pronto, va estratto dal corpo della risposta HTTP originale
     (res.error.context). Se non si riesce, resta un messaggio generico. */
  async function extractFunctionErrorMessage(res, fallback) {
    try {
      if (res.error && res.error.context && typeof res.error.context.json === 'function') {
        var body = await res.error.context.json();
        if (body && body.error) return body.error;
      }
    } catch (err) { /* ignora, si usa il fallback */ }
    return (res.error && res.error.message) || fallback || 'Errore sconosciuto';
  }

  /* Crea davvero un utente Supabase Auth (Edge Function "create-account",
     Admin API: serve a creare l'utente già confermato, senza il giro di mail
     di conferma) + la riga di profilo in accounts con lo stesso id. Poi
     questo dispositivo fa subito login con le stesse credenziali, così parte
     con una sessione vera (serve per tutte le richieste protette da RLS). */
  async function createAccount(input) {
    var email = (input.email || '').trim();
    var password = input.password || '';

    var res = await supabase.functions.invoke('create-account', {
      body: {
        nome: (input.firstName || '').trim() || null,
        cognome: (input.lastName || '').trim() || null,
        username: (input.username || '').trim(),
        email: email,
        password: password,
        dataNascita: input.birthDate || null,
        avatarUrl: input.avatarUrl || null
      }
    });
    if (res.error) throw new Error(await extractFunctionErrorMessage(res, 'Impossibile creare l\'account'));

    var signInRes = await supabase.auth.signInWithPassword({ email: email, password: password });
    if (signInRes.error) throwSupabaseError(signInRes.error);

    var acc = { id: res.data.id, username: res.data.username, avatarUrl: res.data.avatarUrl || '' };
    saveAccountLocal(acc);
    clearGuestLock();
    notifyAccountCreated(acc.id);
    return acc;
  }

  /* Email di benvenuto (Edge Function "notify-account-created" + Resend),
     "fire and forget": non deve MAI bloccare né far fallire la creazione
     dell'account se l'invio va storto (Resend non configurato, rete assente,
     ecc.) — per questo non si fa await e si ignora ogni errore. */
  function notifyAccountCreated(accountId) {
    supabase.functions.invoke('notify-account-created', { body: { accountId: accountId } })
      .catch(function (err) { /* non blocca: l'account è comunque creato */ });
  }

  /* Legge il profilo completo (senza password) dell'account di questo dispositivo. */
  async function fetchOwnAccount() {
    var acc = getAccount();
    if (!acc || !acc.id) return null;

    var res = await supabase.rpc('get_own_account');
    if (res.error) throwSupabaseError(res.error);
    if (!res.data) return null;

    return {
      id: res.data.id,
      firstName: res.data.nome || '',
      lastName: res.data.cognome || '',
      username: res.data.username || '',
      email: res.data.email || '',
      birthDate: res.data.dataNascita || '',
      avatarUrl: res.data.avatarUrl || ''
    };
  }

  /* Aggiorna l'account esistente. "input" può contenere solo i campi cambiati;
     gli altri vengono letti dal profilo attuale. input.password vuoto/assente
     = non cambiare la password (gestito lato server). Stesso discorso per
     input.avatarUrl: se assente, resta la foto gia' salvata. */
  async function updateAccount(input) {
    var acc = getAccount();
    if (!acc || !acc.id) throw new Error('Nessun profilo esistente su questo dispositivo.');

    var current = await fetchOwnAccount();
    if (!current) throw new Error('Profilo non trovato.');

    var merged = {
      firstName: input.firstName !== undefined ? input.firstName : current.firstName,
      lastName: input.lastName !== undefined ? input.lastName : current.lastName,
      email: input.email !== undefined ? input.email : current.email,
      birthDate: input.birthDate !== undefined ? input.birthDate : current.birthDate,
      avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : current.avatarUrl
    };

    // Cambio password (opzionale): passa direttamente da Supabase Auth,
    // richiede una sessione attiva (c'è di sicuro, dato che per arrivare qui
    // bisogna già essere loggati). Il nome utente non si può più cambiare
    // dopo la registrazione (invariato da prima), quindi non viene inviato.
    if (input.password) {
      if (input.password.length < 8) throw new Error('La password deve avere almeno 8 caratteri.');
      var pwRes = await supabase.auth.updateUser({ password: input.password });
      if (pwRes.error) throwSupabaseError(pwRes.error);
    }

    var res = await supabase.rpc('update_account', {
      p_nome: (merged.firstName || '').trim() || null,
      p_cognome: (merged.lastName || '').trim() || null,
      p_email: (merged.email || '').trim() || null,
      p_data_nascita: merged.birthDate || null,
      p_avatar_url: merged.avatarUrl || null
    });
    if (res.error) throwSupabaseError(res.error);

    var acc2 = { id: acc.id, username: res.data.username, avatarUrl: merged.avatarUrl || '' };
    saveAccountLocal(acc2);
    return acc2;
  }

  /* Carica un'immagine sul bucket Storage "avatars" e restituisce l'URL pubblico
     da salvare come avatarUrl. Ogni file ha un nome unico, cosi' non si sovrascrivono
     tra loro le foto di account diversi (o caricamenti ripetuti dello stesso account). */
  async function uploadAvatar(file) {
    if (!file) return null;

    var ext = 'jpg';
    if (file.name && file.name.indexOf('.') !== -1) {
      ext = file.name.split('.').pop().toLowerCase();
    }
    var path = 'avatar-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;

    var uploadRes = await supabase.storage.from('avatars').upload(path, file, {
      upsert: false,
      contentType: file.type || undefined
    });
    if (uploadRes.error) throw new Error(uploadRes.error.message);

    var publicRes = supabase.storage.from('avatars').getPublicUrl(path);
    return publicRes.data.publicUrl;
  }

  /* Stessa logica di uploadAvatar(), ma sul bucket "event-photos": foto
     dell'evento, mostrata in evento.html e come anteprima nelle card. */
  async function uploadEventPhoto(file) {
    if (!file) return null;

    var ext = 'jpg';
    if (file.name && file.name.indexOf('.') !== -1) {
      ext = file.name.split('.').pop().toLowerCase();
    }
    var path = 'event-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;

    var uploadRes = await supabase.storage.from('event-photos').upload(path, file, {
      upsert: false,
      contentType: file.type || undefined
    });
    if (uploadRes.error) throw new Error(uploadRes.error.message);

    var publicRes = supabase.storage.from('event-photos').getPublicUrl(path);
    return publicRes.data.publicUrl;
  }

  /* Carica una nota vocale (Blob prodotto da MediaRecorder, non un File con
     nome: l'estensione si deduce dal mime-type) sul bucket "event-audio",
     stessa idea/policy di "event-photos". Usata come alternativa al testo
     per la descrizione dell'evento (Fil, 2026-07-07: o testo o vocale, mai
     insieme) — quale dei due mostrare/modificare lo decide la pagina che
     chiama questa funzione, qui si carica solo il file. */
  async function uploadEventAudio(blob) {
    if (!blob) return null;

    var mime = blob.type || 'audio/webm';
    var ext = mime.indexOf('mp4') !== -1 ? 'm4a' : (mime.indexOf('ogg') !== -1 ? 'ogg' : 'webm');
    var path = 'event-audio-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;

    var uploadRes = await supabase.storage.from('event-audio').upload(path, blob, {
      upsert: false,
      contentType: mime
    });
    if (uploadRes.error) throw new Error(uploadRes.error.message);

    var publicRes = supabase.storage.from('event-audio').getPublicUrl(path);
    return publicRes.data.publicUrl;
  }

  /* ---------- liste amici ----------
     Solo chi ha un account può creare liste (ed eventi): lo si controlla lato
     client (CiSiamoData.hasAccount()) prima di mostrare i form, dato che
     l'app non ha un vero login/sessione a livello di database.

     Una lista è solo un elenco privato di nomi ad uso di chi la crea (Fil +
     Virgi, 2026-07-05): niente più link di invito né conferma da parte di chi
     ci sta dentro. Serve solo a compilare più in fretta gli invitati quando
     crei un evento: i nomi scelti vengono COPIATI sull'evento al momento
     della creazione (vedi event_invitees più sotto) e da lì in poi lista ed
     evento non hanno più nulla in comune. Il "chi sei tra questi nomi" +
     conferma d'identità ora vive a livello di evento, non più di lista. */

  /* ownerAccountId serve solo lato client per capire "questa lista è mia?"
     (usato da notifiche.html); non è mai stato un dato sensibile, dato che
     friend_lists è già una tabella a lettura pubblica (vedi le policy RLS). */

  function mapFriend(f) {
    return {
      id: f.id,
      name: f.name,
      accountId: f.account_id || null,
      linkStatus: f.link_status || 'none',
      requestedAt: f.requested_at || null,
      acceptedAt: f.accepted_at || null,
      inviteToken: f.invite_token || null
    };
  }

  function mapFriendList(list) {
    return {
      id: list.id,
      name: list.name,
      ownerAccountId: list.owner_account_id || null,
      ownerName: list.owner_name || '',
      friends: (list.friends || []).map(mapFriend)
    };
  }

  var FRIEND_LIST_SELECT = 'id, name, owner_account_id, owner_name, '
    + 'friends(id, name, account_id, link_status, requested_at, accepted_at, invite_token)';

  /* Più recenti in cima, le più vecchie scendendo (Fil, 2026-07-05).
     IMPORTANTE (bug corretto 2026-07-10, segnalato da Fil dopo un test con
     un'amica): questa query non filtrava per proprietario, quindi tornava
     le liste amici di TUTTI gli utenti — ognuno vedeva (e poteva modificare
     o cancellare) anche le liste di chiunque altro, con risultati che
     "saltavano" da un telefono all'altro. Ora si limita alle liste create
     da chi sta guardando. */
  async function getFriendLists() {
    var acc = getAccount();
    if (!acc || !acc.id) return [];
    var res = await supabase
      .from('friend_lists')
      .select(FRIEND_LIST_SELECT)
      .eq('owner_account_id', acc.id)
      .order('created_at', { ascending: false });
    if (res.error) throwSupabaseError(res.error);
    return (res.data || []).map(mapFriendList);
  }

  async function getFriendListById(id) {
    if (!id) return null;
    var res = await supabase
      .from('friend_lists')
      .select(FRIEND_LIST_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (res.error) throwSupabaseError(res.error);
    return res.data ? mapFriendList(res.data) : null;
  }

  /* Solo un account registrato può creare una lista: il nome del creatore
     viene "fotografato" al momento della creazione (così resta leggibile
     anche se in futuro l'account collegato cambia username o viene rimosso). */
  async function createFriendList(name) {
    var acc = getAccount();
    if (!acc || !acc.id) throw new Error('Devi creare un profilo per creare una lista amici.');

    var res = await supabase
      .from('friend_lists')
      .insert({
        name: (name || 'Lista senza nome').trim(),
        owner_account_id: acc.id,
        owner_name: acc.username || ''
      })
      .select('id, name, owner_name')
      .single();
    if (res.error) throwSupabaseError(res.error);
    return {
      id: res.data.id,
      name: res.data.name,
      ownerName: res.data.owner_name || '',
      friends: []
    };
  }

  async function deleteFriendList(listId) {
    var acc = getAccount();
    var res = await supabase
      .from('friend_lists')
      .delete()
      .eq('id', listId)
      .eq('owner_account_id', acc && acc.id ? acc.id : '__no-account__');
    if (res.error) throwSupabaseError(res.error);
  }

  /* Controllo di proprietà prima di aggiungere/togliere un amico: "friends"
     non ha una colonna owner propria (appartiene a una lista tramite
     friend_list_id), quindi si verifica sulla lista genitore. Stesso bug e
     stessa data di getFriendLists() qui sopra — senza questo controllo era
     possibile modificare la lista di qualcun altro semplicemente avendone
     l'id (che peraltro arrivava già in chiaro dal bug di getFriendLists). */
  async function assertOwnsFriendList(listId) {
    var acc = getAccount();
    if (!acc || !acc.id) throw new Error('Devi creare un profilo per gestire le liste amici.');
    var list = await getFriendListById(listId);
    if (!list || list.ownerAccountId !== acc.id) throw new Error('Questa lista non è tua.');
  }

  /* accountId (opzionale) è il collegamento scelto dalla ricerca username+foto
     (vedi CiSiamoUI.attachAccountSearch in script.js e il documento
     "ci-siamo-omonimi.pdf"). Aggiornamento 2026-07-12 (Opzione B, "amicizia
     vera"): scegliere un account qui NON lo collega più subito per sempre —
     parte una richiesta ("pending"), e resta un collegamento debole finché
     il destinatario non la accetta da Notifiche (vedi respondFriendRequest).
     Solo dopo l'accettazione (link_status 'accepted') gli eventi futuri
     creati con questa lista lo riconoscono senza dover riconfermare ogni
     volta. */
  async function addFriendToList(listId, friendName, accountId) {
    var name = (friendName || '').trim();
    if (!name) return null;
    await assertOwnsFriendList(listId);
    var row = { friend_list_id: listId, name: name, account_id: accountId || null };
    if (accountId) {
      row.link_status = 'pending';
      row.requested_at = new Date().toISOString();
    }
    var res = await supabase
      .from('friends')
      .insert(row)
      .select('id, name, account_id, link_status, requested_at, accepted_at, invite_token')
      .single();
    if (res.error) throwSupabaseError(res.error);
    return mapFriend(res.data);
  }

  /* Collega (o ricollega) un amico già in lista a un account trovato con la
     ricerca, in un secondo momento — stessa logica di addFriendToList sopra,
     ma su una riga che esiste già. Passa dall'RPC perché il controllo "sei
     davvero il proprietario di questa lista" va rifatto lato server (l'RPC è
     SECURITY DEFINER, bypassa le RLS). */
  async function requestFriendLink(friendId, targetAccountId) {
    var res = await supabase.rpc('request_friend_link', {
      p_friend_id: friendId,
      p_target_account_id: targetAccountId
    });
    if (res.error) throwSupabaseError(res.error);
    return res.data;
  }

  /* Le richieste di amicizia in attesa dove IO sono il destinatario (vedi
     notifiche.html): solo id/nome lista/username di chi invita, niente
     altro. */
  async function getMyPendingFriendRequests() {
    var res = await supabase.rpc('get_my_pending_friend_requests');
    if (res.error) throwSupabaseError(res.error);
    return (res.data || []).map(function (row) {
      return {
        friendId: row.friend_id,
        friendListName: row.friend_list_name,
        ownerUsername: row.owner_username,
        requestedAt: row.requested_at
      };
    });
  }

  /* Accetta o rifiuta una richiesta ricevuta: l'RPC verifica da sola che sia
     davvero rivolta a me (auth.uid()), non c'è modo di accettare/rifiutare
     per conto di qualcun altro. */
  async function respondFriendRequest(friendId, accept) {
    var res = await supabase.rpc('respond_friend_request', {
      p_friend_id: friendId,
      p_accept: !!accept
    });
    if (res.error) throwSupabaseError(res.error);
    return res.data;
  }

  /* Percorso alternativo "link personale per questo amico": aprirlo da loggati
     conferma subito, senza passare da un "pending" prima (stesso spirito del
     link diretto di un evento in amico.html: il link stesso è il consenso). */
  async function acceptFriendInviteToken(token) {
    var res = await supabase.rpc('accept_friend_invite_token', { p_token: token });
    if (res.error) throwSupabaseError(res.error);
    return res.data;
  }

  /* Ricerca account per username (Opzione A del documento omonimi): usata dai
     suggerimenti mentre scrivi un nome, in amici.html e in crea.html. Nessun
     dato sensibile: solo id/username/foto tornano indietro. */
  async function searchAccounts(query) {
    var q = (query || '').trim();
    if (q.length < 2) return [];
    var res = await supabase.rpc('search_accounts', { p_query: q });
    if (res.error) return [];
    return (res.data || []).map(function (row) {
      return { id: row.id, username: row.username, avatarUrl: row.avatar_url };
    });
  }

  async function removeFriendFromList(listId, friendId) {
    await assertOwnsFriendList(listId);
    var res = await supabase.from('friends').delete().eq('id', friendId);
    if (res.error) throwSupabaseError(res.error);
  }

  /* Accede con un account già esistente (email + password), anche creato
     da un altro telefono: se le credenziali sono corrette, questo dispositivo
     lo adotta come proprio account locale, esattamente come dopo una
     registrazione. Usato dal flusso di invito (amico.html) e da profilo.html. */
  async function loginAccount(email, password) {
    var signInRes = await supabase.auth.signInWithPassword({
      email: (email || '').trim(),
      password: password || ''
    });
    if (signInRes.error) throw new Error('Email o password non corretti');

    var profileRes = await supabase.rpc('get_own_account');
    if (profileRes.error) throwSupabaseError(profileRes.error);
    if (!profileRes.data) throw new Error('Profilo non trovato.');

    var acc = { id: profileRes.data.id, username: profileRes.data.username, avatarUrl: profileRes.data.avatarUrl || '' };
    saveAccountLocal(acc);
    clearGuestLock();
    return acc;
  }

  /* Chiede il reset della password per una email (Edge Function
     "request-password-reset" + Resend). Risponde sempre "ok" indipendentemente
     dal fatto che l'email esista o no: non deve mai rivelare quali email sono
     registrate. Se l'email esiste davvero, arriva un link per sceglierne una
     nuova (vedi resetPassword). */
  async function requestPasswordReset(email) {
    var res = await supabase.functions.invoke('request-password-reset', { body: { email: (email || '').trim() } });
    if (res.error) throwSupabaseError(res.error);
    return true;
  }

  /* Completa il reset con il token ricevuto via email (letto da
     profilo.html?resetToken=...): se il token è valido e non scaduto, imposta
     la nuova password e questo dispositivo adotta subito l'account, come
     dopo un login normale. */
  async function resetPassword(token, newPassword) {
    var res = await supabase.rpc('reset_password_with_token', {
      p_token: token,
      p_new_password: newPassword || ''
    });
    if (res.error) throwSupabaseError(res.error);

    // La password è cambiata sia in accounts che in auth.users (vedi RPC),
    // ma questo dispositivo non ha ancora una sessione vera: la prende ora,
    // stessa email restituita dalla RPC + la password appena scelta.
    var signInRes = await supabase.auth.signInWithPassword({ email: res.data.email, password: newPassword || '' });
    if (signInRes.error) throwSupabaseError(signInRes.error);

    var acc = { id: res.data.id, username: res.data.username, avatarUrl: res.data.avatarUrl || '' };
    saveAccountLocal(acc);
    clearGuestLock();
    return acc;
  }

  /* ---------- accedi con Google ----------
     Fil, 2026-07-12: "come tutti gli altri siti al mondo". Da Google arrivano
     solo email + nome + cognome + foto (scope standard "openid email
     profile"): niente password (Google gestisce l'accesso, noi non la
     vediamo mai) e niente data di nascita (dato troppo sensibile per lo
     scope base). Username e data di nascita restano da chiedere a parte, una
     sola volta, la prima volta che arriva qualcuno da Google. */

  /* Apre la schermata di consenso Google. redirectTo torna sulla STESSA
     pagina (profilo.html): dopo il consenso Supabase aggiunge da solo i
     parametri della sessione nell'URL e il client li legge in automatico
     (detectSessionInUrl, comportamento di default di supabase-js). */
  async function signInWithGoogle() {
    var res = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (res.error) throwSupabaseError(res.error);
    // Non c'è altro da fare qui: signInWithOAuth porta via dalla pagina
    // (redirect vero verso Google), il resto succede al ritorno.
  }

  /* Da chiamare a ogni caricamento di profilo.html PRIMA di guardare
     hasAccount(): capisce se questo dispositivo sta tornando da un login
     Google appena fatto. Tre casi:
     - nessuna sessione Supabase Auth attiva → null (flusso normale, invariato)
     - sessione attiva e profilo già esistente (Google usato altre volte, o da
       un altro telefono) → adotta subito l'account, come un login normale
     - sessione attiva ma NESSUN profilo ancora → prima volta con Google,
       serve completare username + data di nascita (vedi completeGoogleProfile) */
  async function getGoogleSignupState() {
    var sessionRes = await supabase.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session;
    if (!session || !session.user) return null;

    var res = await supabase.rpc('get_own_account');
    if (!res.error && res.data) {
      var acc = { id: res.data.id, username: res.data.username, avatarUrl: res.data.avatarUrl || '' };
      saveAccountLocal(acc);
      clearGuestLock();
      return { needsProfile: false, account: acc };
    }

    var meta = session.user.user_metadata || {};
    var fullName = meta.full_name || meta.name || '';
    var nameParts = fullName.split(' ');
    return {
      needsProfile: true,
      suggested: {
        email: session.user.email || '',
        firstName: meta.given_name || nameParts[0] || '',
        lastName: meta.family_name || nameParts.slice(1).join(' ') || '',
        avatarUrl: meta.avatar_url || meta.picture || ''
      }
    };
  }

  /* Completa il profilo dopo il primo accesso con Google: sessione già
     attiva (auth.uid() la vede da sola), qui si scelgono solo username e
     data di nascita, il resto arriva da Google (vedi RPC lato server). */
  async function completeGoogleProfile(input) {
    var res = await supabase.rpc('complete_google_profile', {
      p_username: (input.username || '').trim(),
      p_nome: (input.firstName || '').trim() || null,
      p_cognome: (input.lastName || '').trim() || null,
      p_data_nascita: input.birthDate || null,
      p_avatar_url: input.avatarUrl || null
    });
    if (res.error) throwSupabaseError(res.error);

    var acc = { id: res.data.id, username: res.data.username, avatarUrl: res.data.avatarUrl || '' };
    saveAccountLocal(acc);
    clearGuestLock();
    return acc;
  }

  /* ---------- eventi ----------
     Ogni evento porta con sé le sue date proposte (dateOptions) e chi ha
     risposto (participants), rinominate con gli stessi nomi che usava la
     versione con localStorage, così il resto dell'app non deve cambiare.

     Da qui in poi ogni evento ha anche un suo share_token e i suoi invitati
     (event_invitees), copiati dalla lista amici scelta (o scritti a mano) al
     momento della creazione: il link "chi sei tra questi nomi" (amico.html)
     ora punta sempre a un evento, non più a una lista amici (Fil + Virgi,
     2026-07-05). */

  var EVENT_SELECT = 'id, name, description, descriptionAudioUrl:description_audio_url, quota, '
    + 'photoUrl:photo_url, '
    + 'locationAddress:location_address, locationPlaceId:location_place_id, '
    + 'locationLat:location_lat, locationLng:location_lng, '
    + 'createdBy:created_by, createdByAccountId:created_by_account_id, friendListId:friend_list_id, createdAt:created_at, '
    + 'cancelledAt:cancelled_at, shareToken:share_token, openInvite:open_invite, '
    + 'confirmedDateOptionId:confirmed_date_option_id, '
    + 'dateOptions:date_options!date_options_event_id_fkey(id, dateISO:date_iso), '
    + 'participants(name, availableDateOptionIds:available_date_option_ids, accountId:account_id), '
    + 'invitees:event_invitees(id, name, accountId:account_id, claimedAt:claimed_at)';

  /* ---------- visibilità eventi ----------
     Bug segnalato da Fil il 2026-07-12 (test con un secondo account sul
     tablet): un invitato scritto a testo libero (mai confermato) bastava a
     far comparire l'evento nella Home di CHIUNQUE avesse in futuro quello
     stesso username, perché il confronto era per nome. Ora conta solo un
     collegamento account CONFERMATO (organizzatore, invitato con account_id,
     o partecipante con account_id): un nome scritto a mano senza conferma
     non dà più accesso a nessuno, resta "invitato di carta" finché non si
     collega davvero (vedi anche ci-siamo-omonimi.pdf). Di proposito NON
     tocca getEventById()/getEventInviteInfo(): aprire un evento dal link
     diretto deve restare possibile per chi lo riceve (è il meccanismo di
     invito stesso, ora passa da get_event_public lato server) — questo
     filtro riguarda solo cosa compare nelle liste (Home/Eventi), non cosa si
     può aprire avendo il link. Chi non ha un account (ospite bloccato su un
     singolo evento da checkAccessGate) non arriva mai a questa lista. */
  function isEventVisibleToMe(event, myAccountId) {
    if (!myAccountId) return false;
    if (event.createdByAccountId && event.createdByAccountId === myAccountId) return true;

    var invitees = event.invitees || [];
    if (invitees.some(function (f) { return f.accountId === myAccountId; })) return true;

    var participants = event.participants || [];
    return participants.some(function (p) { return p.accountId === myAccountId; });
  }

  function filterVisibleEvents(events) {
    var acc = getAccount();
    var myAccountId = acc && acc.id;
    return (events || []).filter(function (e) { return isEventVisibleToMe(e, myAccountId); });
  }

  /* ---------- pulizia eventi annullati ----------
     Un evento "annullato" è uno stato CALCOLATO (vedi computeEventStatus), non
     salvato: qui si "fotografa" il momento in cui lo si osserva annullato per
     la prima volta (cancelled_at), e quelli annullati da più di una settimana
     vengono cancellati per sempre (Fil: "li lascerei nella tab annullati per 1
     settimana e poi si cancellano"). Cascata già presente sul DB: cancellare
     l'evento cancella da sé le sue date_options e participants. "Fire and
     forget" come le email: non deve mai rallentare né far fallire il
     caricamento della lista eventi. */
  var CANCELLED_TTL_DAYS = 7;

  function pruneCancelledEvents(events) {
    (events || []).forEach(function (ev) {
      var info = computeEventStatus(ev);
      if (info.status !== 'cancelled') return;

      if (!ev.cancelledAt) {
        // "fire and forget": .catch() non esiste sul query builder di
        // supabase-js (solo .then), usarlo lanciava un TypeError SINCRONO
        // che risaliva fino a chi chiamava getEventById()/getEvents() qui
        // sotto — bug segnalato da Fil il 2026-07-07 ("non sono riuscito a
        // salvare la tua disponibilità... .catch is not a function").
        // .then(onFulfilled, onRejected) fa la stessa cosa senza il bug.
        supabase.from('events').update({ cancelled_at: new Date().toISOString() }).eq('id', ev.id)
          .then(function () {}, function (err) { /* ignora */ });
        return;
      }

      var ageMs = Date.now() - new Date(ev.cancelledAt).getTime();
      if (ageMs >= CANCELLED_TTL_DAYS * 24 * 60 * 60 * 1000) {
        supabase.from('events').delete().eq('id', ev.id)
          .then(function () {}, function (err) { /* ignora */ });
      }
    });
  }

  /* Link pubblico di Google Maps per una posizione salvata su un evento: usa il
     place_id quando c'è (più preciso, apre proprio quel luogo) altrimenti le
     coordinate, altrimenti l'indirizzo scritto a mano. Torna null se l'evento
     non ha nessuna posizione salvata. */
  function buildMapsUrl(event) {
    if (event.locationPlaceId) {
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(event.locationAddress || '')
        + '&query_place_id=' + encodeURIComponent(event.locationPlaceId);
    }
    if (event.locationLat != null && event.locationLng != null) {
      return 'https://www.google.com/maps/search/?api=1&query=' + event.locationLat + ',' + event.locationLng;
    }
    if (event.locationAddress) {
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(event.locationAddress);
    }
    return null;
  }

  async function getEvents() {
    var res = await supabase
      .from('events')
      .select(EVENT_SELECT)
      .order('created_at', { ascending: false });
    if (res.error) throwSupabaseError(res.error);
    var events = res.data || [];
    pruneCancelledEvents(events);
    return filterVisibleEvents(events);
  }

  /* Passa da get_event_public (SECURITY DEFINER), non più da una select
     diretta sulla tabella: da quando le RLS sono strette (Task 2) "events"
     non è più leggibile in blocco da chi non è coinvolto, ma aprire un
     evento dal link diretto deve restare possibile per chiunque lo riceva —
     è il meccanismo di invito stesso, non un privilegio in più. */
  async function getEventById(id) {
    if (!id) return null;
    var res = await supabase.rpc('get_event_public', { p_id: id });
    if (res.error) throwSupabaseError(res.error);
    if (res.data) pruneCancelledEvents([res.data]);
    return res.data || null;
  }

  /* input.inviteeNames: array di invitati copiati su QUESTO evento — che
     vengano da una lista amici scelta o scritti a mano in crea.html non fa
     differenza, da qui in poi vivono solo sull'evento. Ogni voce può essere
     una semplice stringa (nome libero, nessun collegamento certo) oppure un
     oggetto { name, accountId } quando il nome è stato scelto da un
     suggerimento username+foto (vedi searchAccounts sopra e il documento
     "ci-siamo-omonimi.pdf", Opzione A, 2026-07-07): in quel caso l'invitato
     nasce già "riconosciuto" (account_id + claimed_at impostati subito),
     invece di doverlo dedurre più avanti indovinando dal solo testo — è
     proprio questo che elimina il rischio di collegare per sbaglio la
     persona giusta a un account omonimo ma sconosciuto.
     input.friendListId resta solo come riferimento informativo (quale lista
     hai usato per compilarli), non serve più a nulla per l'invito vero e
     proprio. */
  function normalizeInviteeEntry(entry) {
    if (entry && typeof entry === 'object') {
      return { name: (entry.name || '').trim(), accountId: entry.accountId || null };
    }
    return { name: (entry || '').trim(), accountId: null };
  }

  async function createEvent(input) {
    var creatorAcc = getAccount();
    var insertRes = await supabase
      .from('events')
      .insert({
        name: (input.name || 'Evento senza nome').trim(),
        description: (input.description || '').trim(),
        quota: Math.max(1, parseInt(input.quota, 10) || 1),
        created_by: (input.createdBy || '').trim() || null,
        created_by_account_id: creatorAcc && creatorAcc.id ? creatorAcc.id : null,
        friend_list_id: input.friendListId || null,
        photo_url: input.photoUrl || null,
        location_address: (input.locationAddress || '').trim() || null,
        location_place_id: input.locationPlaceId || null,
        location_lat: (input.locationLat === undefined || input.locationLat === null) ? null : input.locationLat,
        location_lng: (input.locationLng === undefined || input.locationLng === null) ? null : input.locationLng,
        open_invite: !!input.openInvite
      })
      .select('id')
      .single();
    if (insertRes.error) throw new Error(insertRes.error.message);

    var eventId = insertRes.data.id;

    var dateRows = (input.dates || [])
      .filter(function (d) { return !!d; })
      .map(function (d) { return { event_id: eventId, date_iso: d }; });

    var createdOptionIds = [];
    if (dateRows.length) {
      var dateRes = await supabase.from('date_options').insert(dateRows).select('id');
      if (dateRes.error) throw new Error(dateRes.error.message);
      createdOptionIds = (dateRes.data || []).map(function (r) { return r.id; });
    }

    var inviteeRows = (input.inviteeNames || [])
      .map(normalizeInviteeEntry)
      .filter(function (e) { return !!e.name; })
      .map(function (e) {
        var row = { event_id: eventId, name: e.name };
        if (e.accountId) { row.account_id = e.accountId; row.claimed_at = new Date().toISOString(); }
        return row;
      });
    if (inviteeRows.length) {
      var inviteesRes = await supabase.from('event_invitees').insert(inviteeRows);
      if (inviteesRes.error) throw new Error(inviteesRes.error.message);
    }

    // Chi organizza è per forza "presente": proponendo lui stesso l'evento non
    // avrebbe senso chiedergli poi di rispondere "quando sei disponibile" come
    // fosse un invitato qualsiasi. Lo si conta subito su tutte le date proposte,
    // così l'organizzatore non passa mai dai chip di disponibilità (vedi evento.html).
    var organizerName = (input.createdBy || '').trim();
    if (organizerName && createdOptionIds.length) {
      var partRes = await supabase.from('participants').insert({
        event_id: eventId,
        name: organizerName,
        account_id: creatorAcc && creatorAcc.id ? creatorAcc.id : null,
        available_date_option_ids: createdOptionIds
      });
      if (partRes.error) throw new Error(partRes.error.message);
    }

    notifyEventInvite(eventId);
    return getEventById(eventId);
  }

  /* Email "sei stato invitato a questo evento" (Edge Function
     "notify-event-invite" + Resend) a chi, tra gli invitati copiati
     sull'evento, ha già un account con lo stesso username (quindi un'email
     vera). "Fire and forget" come sopra: non deve mai bloccare né far
     fallire la creazione dell'evento. */
  function notifyEventInvite(eventId) {
    supabase.functions.invoke('notify-event-invite', { body: { eventId: eventId } })
      .catch(function (err) { /* non blocca: l'evento è comunque creato */ });
  }

  /* ---------- modifica ed eliminazione evento ----------
     Aggiunta 2026-07-07 su richiesta di Fil: l'organizzatore può cambiare
     qualunque campo (incluse date, invitati e quota) o eliminare del tutto
     l'evento. Due conseguenze concordate con lui:
     1) se togli una data a cui qualcuno aveva già detto "ci sono", quella
        persona riceve un'email (vedi notifyDateRemoved); se togli un
        invitato che aveva già risposto, la sua risposta sparisce con lui,
        senza notifica (l'ha tolto l'organizzatore di proposito);
     2) ogni salvataggio genera anche una notifica "leggera" dentro l'app
        (notifiche.html) per chi resta invitato, e l'eliminazione una
        notifica + email a chi aveva risposto disponibile. */

  /* notifiche.html oggi ricalcola tutto al volo dagli eventi esistenti: un
     evento eliminato (o una data tolta) non potrebbe generare una notifica
     dopo il fatto, perché quel dato non esiste più. event_notices tiene un
     messaggio "congelato" per nome destinatario, letto in aggiunta al
     calcolo live (vedi getEventNotices più sotto). */
  async function pushEventNotices(rows) {
    if (!rows || !rows.length) return;
    try { await supabase.from('event_notices').insert(rows); } catch (err) { /* non deve mai bloccare il salvataggio dell'evento */ }
  }

  async function getEventNotices(myName) {
    var name = (myName || '').trim();
    if (!name) return [];
    var res = await supabase
      .from('event_notices')
      .select('id, recipientName:recipient_name, eventName:event_name, message, emoji, createdAt:created_at')
      .ilike('recipient_name', name);
    if (res.error) return [];
    return res.data || [];
  }

  /* Email "una data che avevi confermato è stata tolta" (Edge Function
     "notify-date-removed" + Resend). Tutta l'informazione necessaria viaggia
     nel corpo della chiamata (non la rilegge dal DB): l'evento nel frattempo
     esiste ancora (qui si toglie solo una data, non l'evento), ma è più
     semplice ed evita corse tra "l'evento è stato già modificato quando
     arriva la mail" passare già tutto pronto. Fire and forget come le altre
     email dell'app. */
  function notifyDateRemoved(eventName, affected) {
    if (!affected || !affected.length) return;
    supabase.functions.invoke('notify-date-removed', { body: { eventName: eventName, affected: affected } })
      .catch(function (err) { /* non blocca il salvataggio */ });
  }

  /* Email "l'evento è stato eliminato" (Edge Function "notify-event-deleted"
     + Resend), stesso motivo per cui i dati viaggiano nel corpo: l'evento
     sta per sparire dal DB (o è già sparito quando la funzione gira
     davvero), quindi non ha senso che la Edge Function provi a rileggerlo. */
  function notifyEventDeleted(eventName, recipientNames) {
    if (!recipientNames || !recipientNames.length) return;
    supabase.functions.invoke('notify-event-deleted', { body: { eventName: eventName, recipientNames: recipientNames } })
      .catch(function (err) { /* non blocca la cancellazione */ });
  }

  function idsEqualAsSet(a, b) {
    var sa = (a || []).slice().sort();
    var sb = (b || []).slice().sort();
    if (sa.length !== sb.length) return false;
    return sa.every(function (v, i) { return v === sb[i]; });
  }

  /* Aggiorna un evento esistente: nome, descrizione (testo O vocale),
     foto, luogo, quota, date proposte e invitati. input ha la stessa forma
     di createEvent(); input.dates è la lista COMPLETA e finale delle date
     (non solo quelle nuove), stesso discorso per input.inviteeNames. */
  async function updateEvent(eventId, input) {
    var current = await getEventById(eventId);
    if (!current) throw new Error('Evento non trovato.');

    var updateRes = await supabase.from('events').update({
      name: (input.name || 'Evento senza nome').trim(),
      description: (input.description || '').trim(),
      description_audio_url: input.descriptionAudioUrl || null,
      quota: Math.max(1, parseInt(input.quota, 10) || 1),
      photo_url: input.photoUrl || null,
      location_address: (input.locationAddress || '').trim() || null,
      location_place_id: input.locationPlaceId || null,
      location_lat: (input.locationLat === undefined || input.locationLat === null) ? null : input.locationLat,
      location_lng: (input.locationLng === undefined || input.locationLng === null) ? null : input.locationLng,
      open_invite: !!input.openInvite
    }).eq('id', eventId);
    if (updateRes.error) throw new Error(updateRes.error.message);

    /* ---------- invitati: diff prima delle date, così un nome tolto non
       finisce anche nella lista "gli ho tolto una data" qui sotto ---------- */
    var newInviteeEntries = (input.inviteeNames || []).map(normalizeInviteeEntry).filter(function (e) { return !!e.name; });
    var newInviteeNamesLower = newInviteeEntries.map(function (e) { return e.name.toLowerCase(); });
    var currentInvitees = current.invitees || [];
    var removedInvitees = currentInvitees.filter(function (f) { return newInviteeNamesLower.indexOf((f.name || '').toLowerCase()) === -1; });
    var currentInviteeNamesLower = currentInvitees.map(function (f) { return (f.name || '').toLowerCase(); });
    var addedInviteeEntries = newInviteeEntries.filter(function (e) { return currentInviteeNamesLower.indexOf(e.name.toLowerCase()) === -1; });
    var removedInviteeNamesLower = removedInvitees.map(function (f) { return (f.name || '').toLowerCase(); });

    for (var ri = 0; ri < removedInvitees.length; ri++) {
      var invRow = removedInvitees[ri];
      await supabase.from('event_invitees').delete().eq('id', invRow.id);
      // Fil, 2026-07-07: se aveva già risposto, la sua risposta sparisce con lui.
      await supabase.from('participants').delete().eq('event_id', eventId).ilike('name', invRow.name);
    }
    if (addedInviteeEntries.length) {
      var newInviteeRows = addedInviteeEntries.map(function (e) {
        var row = { event_id: eventId, name: e.name };
        if (e.accountId) { row.account_id = e.accountId; row.claimed_at = new Date().toISOString(); }
        return row;
      });
      var insInvRes = await supabase.from('event_invitees').insert(newInviteeRows);
      if (insInvRes.error) throw new Error(insInvRes.error.message);
    }

    /* ---------- date: diff su date_iso ---------- */
    var newDateISOs = (input.dates || []).filter(function (d) { return !!d; });
    var currentOptions = current.dateOptions || [];
    var removedOptions = currentOptions.filter(function (o) { return newDateISOs.indexOf(o.dateISO) === -1; });
    var keptOptions = currentOptions.filter(function (o) { return newDateISOs.indexOf(o.dateISO) !== -1; });
    var keptDateISOs = keptOptions.map(function (o) { return o.dateISO; });
    var addedDateISOs = newDateISOs.filter(function (d) { return keptDateISOs.indexOf(d) === -1; });
    var removedOptionIds = removedOptions.map(function (o) { return o.id; });

    var organizerName = (current.createdBy || '').trim();
    var organizerLower = organizerName.toLowerCase();
    var organizerParticipant = (current.participants || []).filter(function (p) { return organizerName && p.name.toLowerCase() === organizerLower; })[0];
    var oldOptionIds = currentOptions.map(function (o) { return o.id; });
    var organizerWasAutoPresent = !!organizerParticipant && idsEqualAsSet(organizerParticipant.availableDateOptionIds || [], oldOptionIds);

    // chi (non l'organizzatore, non chi è stato appena tolto dagli invitati)
    // perde davvero una data a cui aveva detto "ci sono": va avvisato via email
    var affectedByDateRemoval = [];
    if (removedOptionIds.length) {
      (current.participants || []).forEach(function (p) {
        var pLower = p.name.toLowerCase();
        if (pLower === organizerLower) return;
        if (removedInviteeNamesLower.indexOf(pLower) !== -1) return; // se ne va comunque, niente notifica specifica
        var lostIds = (p.availableDateOptionIds || []).filter(function (id) { return removedOptionIds.indexOf(id) !== -1; });
        if (!lostIds.length) return;
        var lostLabels = removedOptions.filter(function (o) { return lostIds.indexOf(o.id) !== -1; }).map(function (o) { return shortDateLabel(o.dateISO); });
        affectedByDateRemoval.push({ name: p.name, dateLabels: lostLabels });
      });
    }

    // toglie gli id delle date rimosse dalla disponibilità di ognuno (dato
    // stantio altrimenti: quell'id non esisterà più come date_options);
    // salta chi è stato appena rimosso dagli invitati, già cancellato sopra
    if (removedOptionIds.length) {
      for (var pi = 0; pi < (current.participants || []).length; pi++) {
        var part = current.participants[pi];
        var partLower = part.name.toLowerCase();
        if (removedInviteeNamesLower.indexOf(partLower) !== -1) continue;
        var hadRemoved = (part.availableDateOptionIds || []).some(function (id) { return removedOptionIds.indexOf(id) !== -1; });
        if (!hadRemoved) continue;
        var strippedIds = (part.availableDateOptionIds || []).filter(function (id) { return removedOptionIds.indexOf(id) === -1; });
        if (partLower === organizerLower) continue; // l'organizzatore si gestisce a parte sotto, insieme all'aggiunta delle nuove date
        await supabase.from('participants').update({ available_date_option_ids: strippedIds }).eq('event_id', eventId).ilike('name', part.name);
      }
    }

    if (removedOptionIds.length) {
      var delDateRes = await supabase.from('date_options').delete().in('id', removedOptionIds);
      if (delDateRes.error) throw new Error(delDateRes.error.message);
    }

    var addedOptionIds = [];
    if (addedDateISOs.length) {
      var addDateRows = addedDateISOs.map(function (d) { return { event_id: eventId, date_iso: d }; });
      var addDateRes = await supabase.from('date_options').insert(addDateRows).select('id');
      if (addDateRes.error) throw new Error(addDateRes.error.message);
      addedOptionIds = (addDateRes.data || []).map(function (r) { return r.id; });
    }

    // organizzatore: se prima era "sempre presente" senza mai averlo toccato,
    // resta tale su tutte le date finali (quelle rimaste + quelle nuove);
    // se invece aveva già personalizzato i suoi giorni, gli si tolgono solo
    // gli id ormai inesistenti, senza aggiungere le nuove date da solo.
    if (organizerName) {
      var keptOptionIds = keptOptions.map(function (o) { return o.id; });
      if (organizerParticipant) {
        var finalOrganizerIds;
        if (organizerWasAutoPresent) {
          finalOrganizerIds = keptOptionIds.concat(addedOptionIds);
        } else {
          finalOrganizerIds = (organizerParticipant.availableDateOptionIds || []).filter(function (id) { return removedOptionIds.indexOf(id) === -1; });
        }
        await supabase.from('participants').update({ available_date_option_ids: finalOrganizerIds }).eq('event_id', eventId).ilike('name', organizerName);
      } else if (keptOptionIds.length + addedOptionIds.length > 0) {
        // caso raro: evento creato senza date, ora ne guadagna — l'organizzatore
        // non aveva ancora una riga participants, se ne crea una come in createEvent
        await supabase.from('participants').insert({
          event_id: eventId,
          name: organizerName,
          available_date_option_ids: keptOptionIds.concat(addedOptionIds)
        });
      }
    }

    /* ---------- notifiche: data tolta (email + avviso in-app), e un avviso
       generico "evento modificato" per chi resta invitato (chi ha già
       ricevuto l'avviso più specifico sulla data tolta non riceve anche
       questo, per non duplicare) ---------- */
    if (affectedByDateRemoval.length) {
      var dateNoticeRows = affectedByDateRemoval.map(function (a) {
        return {
          recipient_name: a.name,
          event_name: input.name || current.name,
          message: 'Per "' + (input.name || current.name) + '" è stata tolta una data a cui avevi detto di esserci: ' + a.dateLabels.join(', ') + '.',
          emoji: '🗓️'
        };
      });
      pushEventNotices(dateNoticeRows);
      notifyDateRemoved(input.name || current.name, affectedByDateRemoval);
    }

    var speciallyNotifiedLower = affectedByDateRemoval.map(function (a) { return a.name.toLowerCase(); });
    var genericRecipients = newInviteeEntries.map(function (e) { return e.name; }).filter(function (n) {
      var nl = n.toLowerCase();
      return nl !== organizerLower && speciallyNotifiedLower.indexOf(nl) === -1;
    });
    if (genericRecipients.length) {
      var genericRows = genericRecipients.map(function (n) {
        return {
          recipient_name: n,
          event_name: input.name || current.name,
          message: '"' + (input.name || current.name) + '" è stato modificato dall\'organizzatore.',
          emoji: '✏️'
        };
      });
      pushEventNotices(genericRows);
    }

    return getEventById(eventId);
  }

  /* Elimina del tutto un evento: date_options/participants/event_invitees
     spariscono da soli (ON DELETE CASCADE sul DB). Prima di cancellare,
     avvisa (email + notifica in-app) chi aveva risposto disponibile per
     almeno un giorno — non l'organizzatore (è lui che elimina) e non chi
     aveva detto "non ci sono mai" (Fil, 2026-07-07: solo chi aveva davvero
     detto "ci sono" per una data). */
  async function deleteEvent(eventId) {
    var event = await getEventById(eventId);
    if (!event) return;

    var organizerLower = (event.createdBy || '').trim().toLowerCase();
    var recipients = (event.participants || [])
      .filter(function (p) { return (p.availableDateOptionIds || []).length > 0; })
      .filter(function (p) { return p.name.toLowerCase() !== organizerLower; })
      .map(function (p) { return p.name; });

    if (recipients.length) {
      var noticeRows = recipients.map(function (name) {
        return {
          recipient_name: name,
          event_name: event.name,
          message: '"' + event.name + '" è stato eliminato dall\'organizzatore.',
          emoji: '🗑️'
        };
      });
      await pushEventNotices(noticeRows);
      notifyEventDeleted(event.name, recipients);
    }

    var delRes = await supabase.from('events').delete().eq('id', eventId);
    if (delRes.error) throw new Error(delRes.error.message);
  }

  /* Conferma manualmente una data, scavalcando il calcolo automatico
     (quota/pareggio) — pensata per l'organizzatore, in due casi (Fil,
     2026-07-10): chiudere subito senza aspettare che rispondano tutti, o
     sciogliere un pareggio quando più date arrivano appaiate alla quota.
     Vince su tutto il resto in computeEventStatus, qualunque sia lo stato
     attuale (anche prima che la quota sia raggiunta). */
  async function confirmEventDate(eventId, dateOptionId) {
    var res = await supabase
      .from('events')
      .update({ confirmed_date_option_id: dateOptionId })
      .eq('id', eventId);
    if (res.error) throw new Error(res.error.message);
    return getEventById(eventId);
  }

  /* Letta dalla pagina amico.html?token=<share_token dell'evento>: nessun
     dato sensibile, solo il necessario per far scegliere "chi sei" a chi
     apre il link. */
  async function getEventInviteInfo(shareToken) {
    if (!shareToken) return null;
    var res = await supabase.rpc('get_event_public', { p_share_token: shareToken });
    if (res.error) throwSupabaseError(res.error);
    return res.data || null;
  }

  /* Conferma "sono io" su un invitato specifico di un evento (letto con
     getEventInviteInfo). accountId non si manda più all'RPC (Fil, 2026-07-12:
     era possibile spoofare l'account di qualcun altro passando un id a
     piacere): l'RPC guarda auth.uid(), cioè la sessione vera di chi ha
     appena fatto login/registrazione in amico.html — se questo dispositivo
     non ha nessuna sessione, salva solo il nome scelto, senza account.
     Il parametro resta nella firma solo per non dover toccare amico.html. */
  async function claimEventInvitee(shareToken, inviteeId, name, accountId) {
    var res = await supabase.rpc('claim_event_invitee', {
      p_share_token: shareToken,
      p_invitee_id: inviteeId,
      p_name: (name || '').trim() || null
    });
    if (res.error) throwSupabaseError(res.error);
    return res.data;
  }

  /* "Il mio nome non c'è → Aggiungimi": solo sugli eventi con open_invite
     attivo (checkbox in crea.html, Fil 2026-07-07 — vedi anche il documento
     sui "primi utenti"). L'RPC ricontrolla open_invite lato server (non solo
     lato client) e blocca i doppioni per nome, stesso spirito difensivo di
     claim_event_invitee qui sopra. Stessa nota sull'accountId qui sopra. */
  async function addSelfAsInvitee(shareToken, name, accountId) {
    var res = await supabase.rpc('add_self_as_invitee', {
      p_share_token: shareToken,
      p_name: (name || '').trim() || null
    });
    if (res.error) throwSupabaseError(res.error);
    return res.data;
  }

  /* Tra i nomi passati, quali corrispondono già a uno username registrato
     (case-insensitive): usato per il pallino rosso "già registrato" accanto
     a chi non ha ancora risposto a un evento, così l'organizzatore sa a chi
     arriverà una notifica in automatico (in futuro) e a chi deve invece
     scrivere lui. Nessun dato sensibile: solo lo username torna indietro. */
  async function getRegisteredNames(names) {
    var list = (names || []).map(function (n) { return (n || '').trim(); }).filter(function (n) { return !!n; });
    if (!list.length) return [];
    var res = await supabase.rpc('registered_usernames', { p_names: list });
    if (res.error) throwSupabaseError(res.error);
    return (res.data || []).map(function (row) { return (typeof row === 'string') ? row : row.registered_usernames; });
  }

  /* Tra i nomi passati, per quelli che corrispondono già a uno username
     registrato con una foto profilo caricata, restituisce { username,
     avatarUrl }. Usata dalle "bolle" di chi ci sarà su un evento confermato
     (evento.html) per mostrare la foto vera quando c'è, altrimenti resta
     l'iniziale lato client. Nessun dato sensibile: stessa esposizione
     minima di getRegisteredNames/registered_usernames. */
  async function getAvatarsForNames(names) {
    var list = (names || []).map(function (n) { return (n || '').trim(); }).filter(function (n) { return !!n; });
    if (!list.length) return [];
    var res = await supabase.rpc('avatars_for_names', { p_names: list });
    if (res.error) return [];
    return (res.data || []).map(function (row) { return { username: row.username, avatarUrl: row.avatar_url }; });
  }

  /* Come getAvatarsForNames, ma per collegamenti certi (friends.account_id /
     event_invitees.account_id): si cerca per id invece che per nome, quindi
     niente ambiguità possibile tra omonimi. Usata per mostrare la foto vera
     (o l'iniziale) al posto del vecchio pallino verde muto, nelle liste
     amici e invitati (Fil, 2026-07-07). Ritorna una mappa { [accountId]:
     { username, avatarUrl } } per lookup comodo lato chiamante. */
  async function getAvatarsForAccountIds(ids) {
    var list = (ids || []).filter(function (id) { return !!id; });
    if (!list.length) return {};
    var res = await supabase.rpc('avatars_for_ids', { p_ids: list });
    if (res.error) return {};
    var map = {};
    (res.data || []).forEach(function (row) {
      map[row.id] = { username: row.username, avatarUrl: row.avatar_url };
    });
    return map;
  }

  /* Salva/aggiorna la disponibilità di un ospite per un evento.
     Se l'ospite (per nome, senza distinguere maiuscole/minuscole) aveva già
     risposto, sovrascrive la sua risposta invece di crearne una seconda. */
  /* Passa da upsert_participant (SECURITY DEFINER): prima era un accesso
     diretto alla tabella (select+update/insert dal client), che con le RLS
     strette del Task 2 avrebbe bloccato chi risponde senza account (ospite
     arrivato dal link, caso legittimo e voluto). Dentro l'RPC: se c'è una
     sessione vera si usa account_id come chiave — due persone con lo stesso
     nome sullo stesso evento non si sovrascrivono più a vicenda (Task 6) —
     altrimenti si ripiega sul nome, solo per chi è davvero ospite. */
  async function upsertParticipant(eventId, guestName, availableDateOptionIds) {
    var name = (guestName || '').trim();
    if (!name && !hasAccount()) return null;

    var res = await supabase.rpc('upsert_participant', {
      p_event_id: eventId,
      p_name: name || null,
      p_available_date_option_ids: availableDateOptionIds
    });
    if (res.error) throwSupabaseError(res.error);

    return getEventById(eventId);
  }

  /* Calcola stato, percentuale di riempimento e "miglior data" di un evento.
     Chi ha risposto "non ci sono mai" (available_date_option_ids vuoto, salvato
     con un click esplicito, non una non-risposta) resta un partecipante a tutti
     gli effetti ma NON conta per la quota: non potrà mai essere tra le persone
     che confermano una data, quindi contarlo farebbe sembrare l'evento più
     vicino alla conferma di quanto non sia davvero. */
  function computeEventStatus(event) {
    var participants = event.participants || [];
    var neverAvailable = participants.filter(function (p) {
      return (p.availableDateOptionIds || []).length === 0;
    });
    var activeParticipants = participants.filter(function (p) {
      return (p.availableDateOptionIds || []).length > 0;
    });

    var count = activeParticipants.length;
    var quota = event.quota || 1;
    var percent = Math.max(0, Math.min(100, Math.round((count / quota) * 100)));

    // Quante persone risultano invitate in tutto: il numero di invitati
    // copiati sull'evento alla creazione. Serve solo per capire quando TUTTI
    // hanno risposto (vedi sotto); se l'evento non ha invitati (creato prima
    // che diventasse obbligatorio), questo resta null e l'evento non si
    // annulla mai da solo.
    var totalInvited = (event.invitees && event.invitees.length) ? event.invitees.length : null;

    // IMPORTANTE: l'organizzatore NON è mai tra gli invitati (event.invitees
    // lo esclude sempre, vedi createEvent) ma viene comunque inserito subito
    // tra i participants, disponibile su tutte le date — quindi va escluso
    // anche qui, altrimenti la sua sola presenza fa risultare "hanno risposto
    // tutti" appena l'evento nasce, ancora prima che un vero invitato abbia
    // risposto (bug segnalato da Fil, 2026-07-10: eventi con pochi invitati
    // finivano "annullati" subito dopo la creazione).
    var organizerLower = (event.createdBy || '').trim().toLowerCase();
    var totalResponded = participants.filter(function (p) {
      return (p.name || '').trim().toLowerCase() !== organizerLower;
    }).length;

    // conta quante persone sono disponibili per ciascuna data proposta
    var bestOption = null;
    var bestCount = -1;
    (event.dateOptions || []).forEach(function (option) {
      var votes = participants.filter(function (p) {
        return (p.availableDateOptionIds || []).indexOf(option.id) !== -1;
      }).length;
      if (votes > bestCount) {
        bestCount = votes;
        bestOption = option;
      }
    });

    // Tutte le date che sono in pareggio col massimo dei voti (solo se ha
    // senso: più di una data proposta, e almeno una risposta). Serve sia per
    // capire se c'è un vero pareggio da segnalare all'organizzatore, sia per
    // proporgli solo QUELLE quando deve scegliere (Fil, 2026-07-10).
    var tiedOptions = (bestCount > 0 && (event.dateOptions || []).length > 1)
      ? (event.dateOptions || []).filter(function (option) {
          var votes = participants.filter(function (p) {
            return (p.availableDateOptionIds || []).indexOf(option.id) !== -1;
          }).length;
          return votes === bestCount;
        })
      : [];

    // L'organizzatore può confermare una data a mano in qualunque momento
    // (bottone in evento.html), sia per chiudere subito senza aspettare
    // tutti, sia per sciogliere un pareggio arrivato a quota raggiunta: in
    // entrambi i casi questo vince su tutto il resto (Fil, 2026-07-10).
    var confirmedOption = event.confirmedDateOptionId
      ? (event.dateOptions || []).filter(function (o) { return o.id === event.confirmedDateOptionId; })[0]
      : null;

    var status = 'waiting';
    if (confirmedOption) {
      status = 'done';
      bestOption = confirmedOption;
    } else if (count >= quota) {
      // Quota raggiunta ma più di una data appaiata al primo posto: si
      // resta in sospeso finché l'organizzatore non ne sceglie una (invece
      // di far vincere in automatico e silenziosamente la prima inserita).
      status = tiedOptions.length > 1 ? 'tie' : 'done';
    } else if (totalInvited !== null && totalResponded >= totalInvited) {
      // Hanno risposto tutti quelli della lista (disponibili o "non ci sono
      // mai") e non si è comunque raggiunta la quota: non ha più senso restare
      // in attesa, l'evento si annulla da solo.
      status = 'cancelled';
    } else if (quota - count <= 1) {
      status = 'almost';
    }

    // Un evento CONFERMATO diventa "passato" (Fil: "12 ore dopo la data
    // dell'evento") una volta finita anche la mattina del giorno successivo:
    // le date sono salvate senza orario, quindi si dà tutto il giorno
    // dell'evento per svolgersi, poi ancora fino a mezzogiorno del giorno dopo
    // (mezzanotte + 36 ore) prima di considerarlo davvero concluso. Da quel
    // momento sparisce da Home/Eventi e resta visibile solo come archivio nel
    // Profilo (vedi profilo.html).
    if (status === 'done' && bestOption) {
      var eventMidnight = new Date(bestOption.dateISO + 'T00:00:00').getTime();
      var passatoCutoff = eventMidnight + 36 * 60 * 60 * 1000;
      if (Date.now() >= passatoCutoff) {
        status = 'passato';
      }
    }

    var dateLabel;
    if ((status === 'done' || status === 'passato') && bestOption) {
      dateLabel = shortDateLabel(bestOption.dateISO);
    } else if (status === 'cancelled') {
      dateLabel = 'Evento annullato';
    } else if (status === 'tie') {
      dateLabel = 'Pareggio: in attesa che l\'organizzatore scelga';
    } else if ((event.dateOptions || []).length === 1) {
      dateLabel = shortDateLabel(event.dateOptions[0].dateISO);
    } else if ((event.dateOptions || []).length > 1) {
      dateLabel = 'Data da confermare';
    } else {
      dateLabel = 'Nessuna data proposta';
    }

    return {
      status: status,
      count: count,
      quota: quota,
      // Quanti hanno risposto disponibili su quanti invitati in tutto (non la
      // soglia minima per confermare): usato nelle card per mostrare "N di M
      // partecipanti" in modo che si capisca di che numero si tratta (Fil,
      // 2026-07-10). Se l'evento non ha una lista invitati (dati vecchi),
      // ripiega sulla quota, l'unico altro numero "totale" che abbiamo.
      totalInvited: totalInvited !== null ? totalInvited : quota,
      percent: percent,
      bestOption: bestOption,
      tiedOptions: tiedOptions,
      dateLabel: dateLabel,
      neverAvailableNames: neverAvailable.map(function (p) { return p.name; })
    };
  }

  /* ---------- Spese (stile Tricount), dentro l'evento — Fil, 2026-07-13 ----------
     Solo chi ha un account può aggiungere/modificare (le RPC lato server
     rivalidano tutto comunque, anche se qualcuno bypassa questa
     interfaccia). Chi entra in una spesa deve essere tra i "partecipanti
     confermati": chi aveva votato disponibile proprio per la data poi
     fissata — non avrebbe senso dividere una spesa con chi non parteciperà
     davvero. */

  function getConfirmedParticipantNames(event) {
    if (!event || !event.confirmedDateOptionId) return [];
    var confirmedId = event.confirmedDateOptionId;
    return (event.participants || [])
      .filter(function (p) { return (p.availableDateOptionIds || []).indexOf(confirmedId) !== -1; })
      .map(function (p) { return p.name; });
  }

  async function addEventExpense(eventId, input) {
    var res = await supabase.rpc('add_event_expense', {
      p_event_id: eventId,
      p_description: (input.description || '').trim(),
      p_amount: input.amount,
      p_paid_by_name: input.paidByName,
      p_included_names: input.includedNames || [],
      p_emoji: input.emoji || null
    });
    if (res.error) throwSupabaseError(res.error);
    return res.data;
  }

  async function updateEventExpense(expenseId, input) {
    var res = await supabase.rpc('update_event_expense', {
      p_expense_id: expenseId,
      p_description: (input.description || '').trim(),
      p_amount: input.amount,
      p_paid_by_name: input.paidByName,
      p_included_names: input.includedNames || [],
      p_emoji: input.emoji || null
    });
    if (res.error) throwSupabaseError(res.error);
  }

  async function deleteEventExpense(expenseId) {
    var res = await supabase.rpc('delete_event_expense', { p_expense_id: expenseId });
    if (res.error) throwSupabaseError(res.error);
  }

  function formatEuro(amount) {
    var n = Number(amount) || 0;
    return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  /* Saldo per persona (quanto ha pagato meno quanto doveva pagare, in base
     alle spese a cui è inclusa) + conguagli ottimizzati: chi deve dare a
     chi, minimizzando i trasferimenti (algoritmo goloso: il maggior
     creditore incassa dal maggior debitore, si ripete finché nessuno resta
     sbilanciato). Tutto calcolato qui, non nel database: sono solo numeri
     derivati dalle spese, niente da salvare a parte. */
  function computeExpenseBalances(event) {
    var expenses = event.expenses || [];
    var balances = {}; // chiave: nome in minuscolo -> { name, accountId, paid, owed }

    function ensure(name, accountId) {
      var key = (name || '').trim().toLowerCase();
      if (!balances[key]) balances[key] = { name: name, accountId: accountId || null, paid: 0, owed: 0 };
      if (accountId && !balances[key].accountId) balances[key].accountId = accountId;
      return balances[key];
    }

    expenses.forEach(function (ex) {
      var payer = ensure(ex.paidByName, ex.paidByAccountId);
      payer.paid += Number(ex.amount) || 0;

      var shareNames = ex.shareNames || [];
      if (!shareNames.length) return;
      var share = (Number(ex.amount) || 0) / shareNames.length;
      shareNames.forEach(function (name) {
        ensure(name, null).owed += share;
      });
    });

    var list = Object.keys(balances).map(function (key) {
      var b = balances[key];
      return {
        name: b.name,
        accountId: b.accountId,
        paid: Math.round(b.paid * 100) / 100,
        owed: Math.round(b.owed * 100) / 100,
        net: Math.round((b.paid - b.owed) * 100) / 100
      };
    });

    // Conguagli: liste separate da consumare (creditori net>0, debitori
    // net<0), sempre il più grande contro il più grande finché non restano.
    var creditors = list.filter(function (p) { return p.net > 0.01; }).map(function (p) { return { name: p.name, amount: p.net }; });
    var debtors = list.filter(function (p) { return p.net < -0.01; }).map(function (p) { return { name: p.name, amount: -p.net }; });
    creditors.sort(function (a, b) { return b.amount - a.amount; });
    debtors.sort(function (a, b) { return b.amount - a.amount; });

    var settlements = [];
    var ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      var c = creditors[ci], d = debtors[di];
      var amount = Math.min(c.amount, d.amount);
      if (amount > 0.01) {
        settlements.push({ fromName: d.name, toName: c.name, amount: Math.round(amount * 100) / 100 });
      }
      c.amount -= amount;
      d.amount -= amount;
      if (c.amount <= 0.01) ci++;
      if (d.amount <= 0.01) di++;
    }

    return { balances: list, settlements: settlements };
  }

  var STATUS_LABELS = {
    waiting: 'In attesa',
    almost: 'Quasi pieno',
    done: 'Confermato',
    cancelled: 'Annullato',
    passato: 'Passato',
    tie: 'Pareggio'
  };

  /* Genera l'HTML di una card evento, usato sia in Home che in Eventi (e in
     Profilo, solo per gli eventi "passato": vedi profilo.html). */
  function renderEventCardHTML(event) {
    var info = computeEventStatus(event);
    var colorVar = info.status === 'waiting' ? 'var(--sky)'
      : info.status === 'almost' ? 'var(--butter)'
      : info.status === 'cancelled' ? 'var(--cancel)'
      : info.status === 'passato' ? 'var(--ink-soft)'
      : info.status === 'tie' ? 'var(--butter)'
      : 'var(--mint)';

    var thumbHTML = event.photoUrl
      ? '<img src="' + escapeHTML(event.photoUrl) + '" alt="" style="width:44px; height:44px; border-radius:12px; object-fit:cover; flex-shrink:0;">'
      : '';

    // Su un evento annullato o passato il conteggio non significa più nulla
    // (non c'è più niente da confermare): la barra di avanzamento si toglie,
    // resta solo titolo/data/badge, così la card è più corta e pulita.
    var showProgress = info.status !== 'cancelled' && info.status !== 'passato' && info.status !== 'tie';
    var progressHTML = showProgress
      ? ''
        + '<div class="progress-row">'
        + '<div class="progress-track"><div class="progress-fill" data-progress="' + info.percent + '" data-color="' + colorVar + '"></div></div>'
        + '<div class="progress-label"><span class="count-up" data-target="' + info.count + '">0</span> di ' + info.totalInvited + ' partecipanti</div>'
        + '</div>'
      : '';

    // Scorciatoia "Ripeti" direttamente sulla card di un evento annullato,
    // solo per chi l'ha organizzato (Fil, 2026-07-10): prima bisognava per
    // forza aprire il dettaglio. Il tap è intercettato e fermato (vedi
    // initRepeatShortcuts in script.js) prima che raggiunga il link della
    // card, altrimenti aprirebbe anche il dettaglio dell'evento.
    var isOrganizer = (event.createdBy || '').trim().toLowerCase() === (getGuestName() || '').trim().toLowerCase();
    var repeatBtnHTML = (info.status === 'cancelled' && isOrganizer)
      ? '<div class="add-date-btn" data-repeat-event="' + event.id + '" style="margin-top:10px; margin-bottom:0; text-align:center;">🔁 Ripeti questo evento</div>'
      : '';

    return ''
      + '<a class="card reveal' + (info.status === 'done' ? ' is-done' : '') + (info.status === 'cancelled' ? ' is-cancelled' : '') + '" href="evento.html?id=' + encodeURIComponent(event.id) + '">'
      + '<div class="card-top" style="' + (showProgress ? '' : 'margin-bottom:0;') + '">'
      + '<div style="display:flex; align-items:center; gap:10px;">'
      + thumbHTML
      + '<div>'
      + '<div class="card-title">' + escapeHTML(event.name) + '</div>'
      + '<div class="card-date">' + escapeHTML(info.dateLabel) + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="badge ' + info.status + '">' + STATUS_LABELS[info.status] + '</div>'
      + '</div>'
      + progressHTML
      + repeatBtnHTML
      + '</a>';
  }

  global.CiSiamoData = {
    getGuestName: getGuestName,
    setGuestName: setGuestName,
    getAccount: getAccount,
    hasAccount: hasAccount,
    setGuestLock: setGuestLock,
    getGuestLock: getGuestLock,
    clearGuestLock: clearGuestLock,
    checkAccessGate: checkAccessGate,
    checkSessionHealth: checkSessionHealth,
    logOut: logOut,
    renderSessionWarningIfNeeded: renderSessionWarningIfNeeded,
    accountRequiredBlockHTML: accountRequiredBlockHTML,
    createAccount: createAccount,
    updateAccount: updateAccount,
    fetchOwnAccount: fetchOwnAccount,
    uploadAvatar: uploadAvatar,
    uploadEventPhoto: uploadEventPhoto,
    uploadEventAudio: uploadEventAudio,
    getEvents: getEvents,
    getEventById: getEventById,
    createEvent: createEvent,
    updateEvent: updateEvent,
    deleteEvent: deleteEvent,
    confirmEventDate: confirmEventDate,
    getEventNotices: getEventNotices,
    upsertParticipant: upsertParticipant,
    computeEventStatus: computeEventStatus,
    buildMapsUrl: buildMapsUrl,
    formatDateLabel: formatDateLabel,
    shortDateLabel: shortDateLabel,
    escapeHTML: escapeHTML,
    renderEventCardHTML: renderEventCardHTML,
    STATUS_LABELS: STATUS_LABELS,
    getConfirmedParticipantNames: getConfirmedParticipantNames,
    addEventExpense: addEventExpense,
    updateEventExpense: updateEventExpense,
    deleteEventExpense: deleteEventExpense,
    formatEuro: formatEuro,
    computeExpenseBalances: computeExpenseBalances,
    GOOGLE_MAPS_API_KEY: GOOGLE_MAPS_API_KEY,
    getFriendLists: getFriendLists,
    getFriendListById: getFriendListById,
    createFriendList: createFriendList,
    deleteFriendList: deleteFriendList,
    addFriendToList: addFriendToList,
    searchAccounts: searchAccounts,
    removeFriendFromList: removeFriendFromList,
    requestFriendLink: requestFriendLink,
    getMyPendingFriendRequests: getMyPendingFriendRequests,
    respondFriendRequest: respondFriendRequest,
    acceptFriendInviteToken: acceptFriendInviteToken,
    getEventInviteInfo: getEventInviteInfo,
    claimEventInvitee: claimEventInvitee,
    addSelfAsInvitee: addSelfAsInvitee,
    getRegisteredNames: getRegisteredNames,
    getAvatarsForNames: getAvatarsForNames,
    getAvatarsForAccountIds: getAvatarsForAccountIds,
    loginAccount: loginAccount,
    requestPasswordReset: requestPasswordReset,
    resetPassword: resetPassword,
    signInWithGoogle: signInWithGoogle,
    getGoogleSignupState: getGoogleSignupState,
    completeGoogleProfile: completeGoogleProfile
  };

})(window);
