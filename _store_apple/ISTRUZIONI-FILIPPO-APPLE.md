# Istruzioni per Filippo: App Store (iPhone)

Preparato il 25/11/2026, mentre l'account Apple Developer (Individual, a nome di Filippo) è in attivazione.
Tutto è fatto da Linux + GitHub: **non servono Mac né iPhone**.

## 0. Cosa è già pronto (non devi fare niente)
- App iPhone nel repo (`_app_android/ios/`): si compila sul Mac di GitHub (workflow "App iPhone", controllo simulatore OK).
- "Continua con Apple" nell'app + **revoca Apple quando si elimina l'account** (richiesta da Apple): codice pronto,
  la funzione `delete-account` aggiornata va solo pubblicata su Supabase quando ci sono le chiavi (passo 9).
- Frase per il microfono (descrizione vocale) e per fotocamera/foto: senza, Apple chiude l'app e la rifiuta.
- Crittografia già dichiarata nell'app (solo HTTPS): App Store Connect non ti farà domande sull'export.
- Testi della scheda it/en: `_store_apple/testi-scheda-app-store.md`.
- Screenshot iPhone 6.9" e 6.5" (dati inventati, nessun utente vero): `_store_apple/screenshot/`.
- Pagina di supporto `https://seeva.it/supporto` e privacy aggiornata (Apple, notifiche iPhone, eliminazione account).

---

## 1. Quando arriva l'email "Welcome to the Apple Developer Program"
Vai su https://developer.apple.com/account → **Membership details** → copia il **Team ID** (10 caratteri, es. `AB12CD34EF`).

## 2. Registra l'app (identificativo)
developer.apple.com → **Certificates, Identifiers & Profiles** → **Identifiers** → **+** → **App IDs** → **App**:
- Description: `seeva`
- Bundle ID: **Explicit** → `it.seeva.app`
- Capabilities: spunta **Push Notifications** e **Sign In with Apple** (lascia "Enable as a primary App ID").
- Continue → Register.

## 3. Una chiave per notifiche + Accedi con Apple (file .p8)
**Keys** → **+** → nome `seeva push e apple` → spunta **Apple Push Notifications service (APNs)** e
**Sign in with Apple** (Configure → scegli `it.seeva.app`) → Continue → Register → **Download**.
- Scarichi `AuthKey_XXXXXXXXXX.p8`: **si può scaricare una volta sola**. Mettilo in `~/Scrivania/App/_chiavi_seeva/`
  (cartella già esclusa da GitHub) e fanne una copia su chiavetta.
- Annota il **Key ID** (le 10 lettere nel nome del file).

## 4. Chiave per caricare le build (App Store Connect API)
https://appstoreconnect.apple.com → **Utenti e accessi** → **Integrazioni** → **Chiavi API App Store Connect** →
(la prima volta "Richiedi accesso") → **Chiavi del team** → **+** → nome `github`, accesso **Admin** → Genera.
- Annota l'**ID emittente (Issuer ID)** in alto e il **Key ID** della chiave.
- **Scarica** il file `.p8` (una volta sola) → anche questo in `_chiavi_seeva/`.

## 5. Certificato di distribuzione (senza Mac, dal terminale Linux)
Copia e incolla questi comandi uno alla volta:
```bash
cd ~/Scrivania/App/_chiavi_seeva
openssl genrsa -out apple-dist.key 2048
openssl req -new -key apple-dist.key -out apple-dist.csr -subj "/emailAddress=TUA-EMAIL-APPLE/CN=Filippo Bonino/C=IT"
```
(al posto di `TUA-EMAIL-APPLE` metti l'email del tuo account Apple).
Poi su developer.apple.com → **Certificates** → **+** → **Apple Distribution** → carica `apple-dist.csr` →
scarica `distribution.cer` nella stessa cartella. Poi:
```bash
cd ~/Scrivania/App/_chiavi_seeva
openssl x509 -inform der -in distribution.cer -out distribution.pem
openssl pkcs12 -export -legacy -inkey apple-dist.key -in distribution.pem -out apple-dist.p12
```
Ti chiede una password: scegline una e scrivila in `_chiavi_seeva/PASSWORD-APPLE.txt`.
(`-legacy` serve: senza, il Mac di GitHub non riesce a leggere il file.)

## 6. Profilo "App Store"
**Profiles** → **+** → **App Store Connect** (Distribution) → App ID `it.seeva.app` → certificato appena creato →
nome `seeva App Store` → Generate → **Download** (`seeva_App_Store.mobileprovision`) in `_chiavi_seeva/`.

## 7. Segreti su GitHub
github.com/pippobonny/Newapp → Settings → Secrets and variables → Actions → **New repository secret**, uno per riga.
Per i file, il testo da incollare lo ottieni con `base64 -w0 NOMEFILE` (nella cartella `_chiavi_seeva`).

| Nome segreto | Cosa ci metti |
|---|---|
| `APPLE_TEAM_ID` | Team ID (passo 1) |
| `IOS_DIST_CERT_P12` | `base64 -w0 apple-dist.p12` |
| `IOS_DIST_CERT_PASSWORD` | la password del passo 5 |
| `IOS_PROFILE` | `base64 -w0 seeva_App_Store.mobileprovision` |
| `ASC_KEY_ID` | Key ID della chiave del passo 4 |
| `ASC_ISSUER_ID` | Issuer ID del passo 4 |
| `ASC_KEY_P8` | tutto il testo del file `.p8` del passo 4 (apri con l'editor e copia, righe BEGIN/END comprese) |

**Oppure** (più comodo): dimmi solo "ho messo i file in `_chiavi_seeva`" e i segreti li carico io (Claude) con gh, senza mostrarli.

## 8. Crea l'app in App Store Connect
appstoreconnect.apple.com → **App** → **+** → **Nuova app**:
- Piattaforma **iOS**, Nome: `seeva: eventi con amici` (o `seeva` se libero), Lingua principale **Italiano**,
  ID pacchetto `it.seeva.app`, SKU `seeva-ios`, Accesso completo.
- Fatto questo, ogni push su main manda in automatico una build su **TestFlight** (10-30 minuti).

## 9. Lavoro di Claude dopo i passi 1-8 (lo faccio io, dimmelo)
- Su Supabase: segreti `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_KEY_P8` (chiave del passo 3) e pubblicazione di
  `delete-account` nuova (revoca Apple). Provider **Apple** in Authentication con Client ID `it.seeva.app`.
- Notifiche iPhone: segreti `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID` (stessa chiave del passo 3) e pubblicazione
  della funzione `native-push-relay`.
- Controllo che la build arrivi su TestFlight; ti aggiungo come tester interno (installi l'app TestFlight su un iPhone di
  un amico/Virgi per provarla).
- Più avanti: link d'invito che aprono l'app sull'iPhone (serve la capability "Associated Domains" e un file su seeva.it col Team ID).

---

## 10. Cosa rispondere in App Store Connect

### Scheda (testi, URL, screenshot)
Tutto in `testi-scheda-app-store.md`. URL: supporto `https://seeva.it/supporto`, privacy `https://seeva.it/privacy`.

### Privacy dell'app ("Etichetta privacy" / App Privacy)
- "Raccogli dati da questa app?" → **Sì**.
- Spunta questi tipi di dati (per **tutti**: scopo **Funzionalità dell'app**, **collegati all'identità**: Sì,
  **usati per il tracciamento**: **No**):
  - **Informazioni di contatto** → **Nome**, **Indirizzo email**
  - **Contenuti utente** → **Foto o video** (foto profilo e foto evento), **Dati audio** (messaggi vocali negli eventi),
    **Altri contenuti dell'utente** (eventi, commenti, risposte, spese, segnalazioni)
  - **Identificativi** → **ID utente** (nome utente / id dell'account)
  - **Altri dati** → **Altri tipi di dati** (data di nascita)
- **NON** spuntare: Posizione (i luoghi si scrivono a mano), Contatti, Salute, Finanze/Pagamenti, Cronologia,
  Dati d'uso/Analisi, Diagnostica, Dati sensibili, Acquisti, ID dispositivo/pubblicità.
- Tracciamento: **No**. URL privacy: `https://seeva.it/privacy`.

### Classificazione per età (questionario)
- Violenza, sesso/nudità, linguaggio volgare, droghe/alcol/tabacco (come tema), orrore, gioco d'azzardo,
  contenuti medici: **Nessuno / No**.
- Accesso web senza limiti: **No**. Pubblicità: **No**. Concorsi/premi: **No**.
- **Contenuti generati dagli utenti: Sì** (commenti negli eventi). **Messaggi/chat tra utenti: Sì** (commenti).
- Controlli parentali / verifica età: **No**.
- Accetta la classe che esce (probabile 13+ o superiore): va bene, la privacy dice minimo 14 anni.

### Crittografia (Export compliance)
Già dichiarato nell'app ("usa solo crittografia esente"): non ti chiede niente. Se lo chiede: **"Nessuno degli algoritmi
menzionati sopra"** / solo HTTPS standard → esente.

### Informazioni per la revisione (Accesso dell'app)
- "Accesso richiesto" → **Sì**. Usa l'account di prova dedicato **testgoogle**:
  email = testgoogle@seeva.app, password = quella che ti ha dato Claude in chat (scrivila TU direttamente in
  App Store Connect, non metterla in nessun file). Prima controlla di riuscire a entrare con quelle credenziali.
- Consiglio: rinomina l'evento demo "Cena di prova (demo per Google Play)" in "Cena di prova (demo)".
- Contatto: Filippo Bonino, la tua email e il tuo telefono (li vede solo Apple).
- **Note per il revisore** (in inglese, da copiare):

```
seeva is an app to plan events with friends: create an event, suggest dates, friends reply
("I'm in / Maybe / Can't make it") or vote on the date, then get reminders.

Demo account: please sign in with the email and password above (Profile tab > Sign in).
The account already has a sample event "Cena di prova (demo)" with guests, comments and a poll.

- Sign in with Apple is available on the sign-in screen.
- Account deletion: Profile > Delete account (also revokes Sign in with Apple).
- Push notifications: invitations, reminders and organiser messages (optional, asked at first use).
- People without the app can reply to an invite from a web link; the app adds native sign-in,
  push notifications, sharing and calendar features.
- Problems can be reported from Profile > Report a problem.
```
(In italiano dice: cos'è seeva, come entrare con l'account di prova, dove sono Accedi con Apple, Elimina account,
notifiche, segnalazione problemi, e che l'app ha funzioni native oltre al sito.)

### Stato di "commerciante" per l'Unione Europea (Digital Services Act)
App Store Connect lo chiede prima di pubblicare in UE. Se seeva è gratuita e non è un'attività commerciale →
**"Non sono un commerciante"**. Se invece un giorno vendete abbonamenti, diventa "commerciante" e Apple mostra
pubblicamente indirizzo, email e telefono. Per ora: **non commerciante** (decidi tu; nel dubbio chiedi al commercialista).

### Prezzo e disponibilità
Gratis, tutti i paesi (o solo Italia all'inizio, se preferisci).

---

## 11. Rischi di rifiuto da sapere
1. **Contenuti degli utenti (linea guida 1.2)**: Apple vuole, nelle app con commenti tra utenti, un modo per
   **segnalare** un contenuto offensivo e **bloccare** un utente. Oggi c'è solo "Segnala un problema" nel Profilo.
   I commenti sono visibili solo agli invitati dello stesso evento (basso rischio), ma per sicurezza conviene
   aggiungere prima della revisione "Segnala commento" e "Blocca utente". **Da decidere con Claude.**
2. **"Sembra solo un sito" (4.2)**: abbiamo funzioni native (Accedi con Apple, notifiche, condivisione, gesto indietro).
   Le notifiche iPhone devono funzionare davvero prima dell'invio (passo 9).
3. **Spese e "chi porta cosa"**: nella descrizione ci sono; se le togliete dall'app, togliete anche la riga.
4. **Abbonamento**: per ora NON c'è. Se lo aggiungete, va fatto con gli acquisti in-app di Apple (vedi `proposta-abbonamento.md`).
