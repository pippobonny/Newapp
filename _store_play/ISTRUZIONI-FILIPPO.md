# Istruzioni per Filippo: ultimi passi per il Play Store

## 1. Segreti su GitHub (una volta sola)
1. Apri il terminale e lancia questo comando: copia il testo, che e' il keystore trasformato in base64
   (e' gia' pronto anche nel file `~/Scrivania/App/_chiavi_seeva/keystore-base64.txt`):
   `base64 -w0 ~/Scrivania/App/_chiavi_seeva/seeva-upload.keystore`
   Per copiarlo direttamente negli appunti: `base64 -w0 ~/Scrivania/App/_chiavi_seeva/seeva-upload.keystore | xclip -selection clipboard`
   (se xclip non c'e', apri il file keystore-base64.txt e copia tutto).
2. Vai su github.com/pippobonny/Newapp → Settings → Secrets and variables → Actions → New repository secret.
3. Primo segreto: Name `SEEVA_UPLOAD_KEYSTORE`, Value = il testo base64 (tutta una riga, senza spazi o a capo in piu').
4. Secondo segreto: Name `SEEVA_UPLOAD_PASSWORD`, Value = contenuto di `_chiavi_seeva/PASSWORD.txt` (solo la password).
5. Fai partire il workflow "APK Android" (Actions → Run workflow, o un nuovo push su main). Il file `.aab` per il Play Store
   compare in Releases → "seeva per il Play Store (.aab)".

## 2. Copia di sicurezza della chiave
Copia l'intera cartella `~/Scrivania/App/_chiavi_seeva` in DUE posti: una chiavetta USB e il Google Drive dell'account seeva
(meglio in una cartella privata). Non metterla mai su GitHub. Se perdi la chiave si puo' farla sostituire da Google, ma ci vogliono giorni.

## 3. Link d'invito che aprono l'app (assetlinks)
- Nel codice e' gia' tutto pronto: l'app apre i link `https://seeva.it/evento...` e `https://seeva.it/lista-invito...`.
- In Play Console → Test e uscita → Integrita' dell'app (App integrity) → Firma dell'app (Play App Signing) copia
  l'impronta "SHA-256" del **Certificato di firma dell'app** (NON quella della chiave di caricamento).
- Mandala a me (o a Claude): la mettiamo nel file `.well-known/assetlinks.json` al posto di
  `SOSTITUISCI_CON_SHA256_DI_PLAY_APP_SIGNING`, e poi push. Controlla che `https://seeva.it/.well-known/assetlinks.json` si apra.
- Nota: i link aprono l'app, ma oggi l'app parte dalla Home: per farla andare dritta all'evento serve ancora un piccolo
  lavoro nel codice (me lo ricordo io).

## 4. Cosa compilare in Play Console

### Sicurezza dei dati (Data safety)
- Raccogli dati? **Si'**. Condividi dati con terzi? **No** (i fornitori Supabase, Resend, Firebase trattano i dati per conto nostro: non conta come "condivisione").
- Dati cifrati in transito? **Si'** (https). Gli utenti possono chiedere la cancellazione? **Si'**.
- Tipi di dati raccolti (tutti: "raccolti", NON condivisi, necessari per l'app, scopo: Funzionalita' dell'app; per le email anche Comunicazioni):
  - Informazioni personali: **Nome** (nome e cognome), **Indirizzo email**, **ID utente** (nome utente), **Altre info** (data di nascita).
  - Foto e video: **Foto** (foto profilo e foto degli eventi, facoltative). 
  - File audio: **Messaggi vocali** (negli eventi).
  - Messaggi: **Altri messaggi nell'app** (commenti).
  - Info e prestazioni app: **Log di arresto anomalo / diagnostica** solo se avete Crashlytics (oggi NO: lascia vuoto); le segnalazioni di problemi sono testo scritto dall'utente (categoria "Altri contenuti generati dall'utente").
  - Identificatori del dispositivo: **ID dispositivo o altri ID** (token notifiche Firebase), scopo: Funzionalita' dell'app.
  - Posizione: **NO** (i luoghi sono scritti a mano / ricerca Google Maps, non usiamo il GPS).
  - Pagamenti, salute, contatti, rubrica, cronologia web: **NO**.
- Pubblicita' o tracciamento: **nessuno**. Dati venduti: **no**.

### Classificazione dei contenuti (questionario)
- Email di contatto: pippo.bonino@gmail.com. Categoria: "Social / Comunicazione" (o "Altro" se non c'e' adatta: organizzazione di eventi).
- Violenza, sesso, linguaggio volgare, droghe, gioco d'azzardo: **tutto NO**.
- Contenuti generati dagli utenti / interazione tra utenti: **Si'** (commenti negli eventi). Condivisione posizione: **No**. Acquisti digitali: **No**.
- Aspettati una classificazione tipo PEGI 3 / "Per tutti", con avviso di interazione tra utenti.

### Pubblico di destinazione
- Fasce d'eta': **solo 18+** oppure 16+ (la privacy dice "eta' minima": allinea la scelta a quanto scritto in `privacy.html`, sezione "Eta' minima").
- NON selezionare fasce sotto i 13: eviti le regole "Per la famiglia". Non e' un'app pensata per bambini.

### Annunci
- "L'app contiene annunci?" → **No** (per ora). Se un giorno li metti, va aggiornato.

### URL da inserire
- Norme sulla privacy: `https://seeva.it/privacy`
- Eliminazione account (sezione "Eliminazione dell'account" nella scheda Sicurezza dei dati): URL `https://seeva.it/privacy#cancella-account`
  Spiega gia' le due strade: dall'app (Profilo → Elimina account) oppure via email a pippo.bonino@gmail.com entro 30 giorni.
  Indica anche che i dati dei profili vengono cancellati, mentre commenti/spese negli eventi condivisi restano anonimi (e' scritto nella privacy).

### Account di prova per il revisore (Accesso all'app)
Google deve poter entrare. Da fare tu:
1. Crea in seeva un account normale con email + password (NON "Accedi con Google"), es. `revisore.google@...` con una password semplice.
2. Con quell'account crea un evento di esempio, cosi' il revisore vede qualcosa.
3. In Play Console → Contenuti dell'app → Accesso all'app → "Tutte o alcune funzioni sono limitate" → aggiungi: nome utente/email, password,
   e le istruzioni: "Apri l'app, tocca Accedi, inserisci email e password. Nessuna verifica a 2 passaggi."
4. Non scrivere qui password reali che usi altrove.

### Altre voci veloci in "Contenuti dell'app"
App governativa: No. Funzioni finanziarie: No. Salute: No. ID pubblicita': No (non lo usiamo). Notifiche push: si', ma non serve dichiararle.

## 5. Dove sono i file della scheda
`~/Scrivania/App/_store_play/` → `italiano/`, `inglese/` (screenshot e immagine in evidenza), `icona-512.png`.
