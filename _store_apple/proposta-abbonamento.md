# Proposta abbonamento seeva (SOLO BOZZA — niente è stato implementato)

25/11/2026. Da decidere con Virgi. Non serve per la prima versione: si può pubblicare gratis e aggiungerlo dopo.

## 1. L'idea
**seeva gratis** per tutti, con qualche limite. **seeva Plus** a circa **0,99 €/mese** (o 9,99 €/anno) toglie i limiti.

| | Gratis | Plus (0,99 €/mese) |
|---|---|---|
| Rispondere agli inviti, votare, commentare | sempre, senza limiti | sì |
| Eventi organizzati **aperti in contemporanea** | max **2** | illimitati |
| Dividi spese | no (o solo 1 evento di prova) | sì |
| Sondaggi nell'evento | 1 per evento | illimitati |
| Altre idee per Plus | — | temi colore, foto evento più grande, liste amici illimitate, esporta in calendario |

Regola d'oro: **chi viene invitato non deve mai pagare** (sennò gli inviti non funzionano). Paga solo chi organizza tanto.

Quanto si incassa davvero: Apple e Google trattengono il **15%** (programma piccole imprese, sotto 1 milione/anno).
Su 0,99 € restano circa **0,84 €** meno IVA (22% in Italia, Apple la versa per noi) → circa **0,69 € al mese a persona**.
Con 100 abbonati ≈ 70 €/mese. Il piano annuale (9,99 €) conviene a loro e a noi (meno abbandoni).

## 2. Cosa servirebbe tecnicamente
1. **Acquisti in-app di Apple (StoreKit) e Google Play Billing** — obbligatori: dentro l'app NON si possono usare
   PayPal/Stripe/carta per sbloccare funzioni digitali.
2. Modo più semplice: **RevenueCat** (gratis fino a 2.500 $/mese di incassi). Un solo plugin Capacitor
   (`@revenuecat/purchases-capacitor`) che gestisce iPhone e Android, rinnovi, rimborsi, "Ripristina acquisti".
3. **Supabase**: colonna `accounts.plan` (`free`/`plus`) + data di scadenza, aggiornata da un webhook di RevenueCat
   (Edge Function nuova). I limiti vanno controllati **sul server** (RPC/regole del database), non solo nell'app.
4. **App Store Connect**: gruppo di abbonamenti "seeva Plus", prodotti `it.seeva.plus.monthly` e `.yearly`, prezzi,
   testi e uno screenshot della schermata di acquisto per la revisione. Serve aver firmato il **Paid Applications
   Agreement** e inserito banca e dati fiscali (Partita IVA o codice fiscale) in App Store Connect.
5. **Schermata "Passa a Plus"** nell'app con: prezzo e durata chiari, cosa si sblocca, pulsante **Ripristina acquisti**,
   link a **Termini d'uso (EULA)** e **Privacy**. Senza queste cose Apple rifiuta.
6. **Versione web (PWA)**: dal sito non si può comprare nello stesso modo; o Plus solo dall'app, o Stripe sul sito
   (ma dall'app non si può rimandare al sito per pagare, tranne le eccezioni UE/USA).
7. Aggiornare privacy (dati di acquisto) ed etichetta privacy ("Acquisti": Sì).
8. Tempo stimato: 2-4 giorni di lavoro + prove con account "sandbox" di Apple e tester di Google.

## 3. Rischi di rifiuto
- **3.1.1 (acquisti in-app)**: se l'app sblocca funzioni a pagamento con un metodo diverso da Apple, o mostra
  link/pulsanti verso pagamenti esterni → rifiuto. Con StoreKit/RevenueCat il rischio sparisce.
- **3.1.2 (abbonamenti)**: l'abbonamento deve dare valore continuo; prezzo, rinnovo automatico e come disdire
  vanno scritti chiaramente. Bisogna dire cosa resta gratis.
- **4.2 (funzionalità minima / "solo un sito")**: l'abbonamento non c'entra direttamente, ma se l'app sembra un sito
  impacchettato il rischio resta: meglio tenere e aumentare le funzioni native (notifiche, Accedi con Apple, calendario,
  rubrica, widget).
- **5.1.1**: niente dati personali in più del necessario per l'acquisto (RevenueCat usa solo l'id dell'utente).

## 4. Consiglio
1. Prima versione **gratis, senza abbonamento**: si passa la revisione più facilmente e si raccolgono utenti.
2. Quando ci sono almeno qualche centinaio di utenti attivi: aggiungere Plus con RevenueCat, prima su TestFlight.
3. Partire con limiti morbidi (2 eventi aperti) e vedere quanti si abbonano prima di togliere altro.
