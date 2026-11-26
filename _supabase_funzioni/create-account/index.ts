import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* Crea un account vero: prima solo una riga in public.accounts con una
   password fatta in casa (extensions.crypt), ora un utente reale di Supabase
   Auth (auth.users) + la riga di profilo in public.accounts con lo STESSO id.
   Serve la Admin API (service role) perche' solo lei puo' creare un utente
   Auth gia' confermato, senza mandare una mail di conferma che l'app non e'
   pensata per gestire (registrazione dev'essere immediata, un minuto).

   Controlli di unicita' (username, email) fatti PRIMA di creare l'utente
   Auth, cosi' un errore di validazione non lascia un utente Auth orfano
   senza profilo. Se anche cosi' la insert del profilo fallisse, si cancella
   subito l'utente Auth appena creato (rollback manuale).

   Password (audit 26/11/2026): minimo 10 caratteri, lettere e numeri, niente
   password comuni ne' username/email dentro (prima: solo minimo 8). Controllata anche
   qui lato server, non solo nel form, perche' il form si puo' sempre aggirare.

   verify_jwt = false: la registrazione la fa per forza chi non ha ancora
   nessuna sessione, stesso motivo delle altre function di questa app.

   2026-10-14: copia salvata in cartella (prima esisteva solo su Supabase).
   Fix: nei controlli "gia' in uso" i caratteri _ e % dello username/email
   facevano da jolly in ilike (es. "mario_rossi" combaciava con
   "mario1rossi"): ora si cercano letteralmente. */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function errRes(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
// ilike senza jolly: confronto esatto ignorando maiuscole/minuscole
const literal = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

/* Audit 26/11/2026 (A3, M9, M4): stesse regole di data.js (passwordProblem,
   usernameProblem, birthDateProblem) e della funzione SQL password_problem. */
const COMMON_PASSWORDS = new Set("00000000 0000000000 0123456789 0987654321 11111111 1111111111 11223344 12121212 123123123 12341234 1234554321 12345678 123456789 1234567890 147258369 159753 1q2w3e4r 1q2w3e4r5t 1qaz2wsx 9876543210 a1b2c3d4 abc123 abcd1234 abcdefgh abcdefghi abcdefghij acmilan admin admin123 administrator agosto alessandra alessandro amore amore123 amoremio amoremio1 andrea andrea123 anna antonio aperitivo apple aprile asdfasdf asdfghjkl atalanta autunno baseball basket batman bella bellissima bellissimo birra bologna caffe caffe123 calcio calcio123 cane cane123 cena changeme charlie chiara chitarra ciao ciao123 ciao1234 ciaobella ciaobello ciaociao ciaociao1 ciaociao123 ciaomondo cioccolato cisiamo computer contrasena cucciola cucciolo davide dicembre domenica dragon elena estate eventi evento facebook farfalla febbraio federica federico ferrari ferrari123 festa festa123 filippo fiorentina football football1 forzainter forzaitalia forzajuve forzajuventus forzalazio forzamilan forzanapoli forzaroma forzatoro francesca francesco freedom fuffy gatto gatto123 gelato gennaio genoa giovanni girasole giugno giulia giulia123 giuseppe google guitar hello hello123 hello1234 helloworld iloveyou iloveyou1 instagram inter inter123 internazionale internet inverno iphone italia italia123 juve juve123 juventus juventus1 juventus1897 lamborghini laura lazio lazio123 letmein login login123 lorenzo luca luca123 lucky luglio luna luna123 lunedi maggio marco marco123 mare mario mario123 martina marzo master master123 matteo michela micia micio milan milan123 minnie monkey montagna motdepasse motogp music musica napoli napoli123 natale nduma netflix novembre nutella ottobre p4ssw0rd pallavolo pallone paola paperino pasqua passw0rd password password1 password12 password123 password1234 passwort pasta pippo pizza pizza123 pluto pokemon primavera princess principe principessa prova prova123 prova1234 qazwsx qazwsxedc qwerty qwerty123 qwerty1234 qwertyuiop roberto rocky roma roma123 root rossi46 sabato sampdoria samsung sara sara123 secret secret123 seeva seeva123 seeva2026 seevaapp settembre shadow silvia simone soccer sole sole123 spaghetti spiderman starwars stefano stella stellina sunshine superman tennis tesoro tesoro123 test test123 test1234 tiamo tiamo123 tiamotanto tiktok toor topolino torino torino123 trustno1 user user123 vale46 valentina valentino venerdi vespa vino virginia volley welcome welcome1 whatever whatsapp zxcvbnm zxcvbnm123".split(" "));
function passwordProblem(pw: string, username: string, email: string): string {
  if (pw.length < 10) return "La password deve avere almeno 10 caratteri.";
  if (pw.length > 72) return "La password può avere al massimo 72 caratteri.";
  if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/[^A-Za-zÀ-ÿ]/.test(pw.replace(/\s/g, ""))) return "Usa almeno una lettera e un numero.";
  const low = pw.toLowerCase();
  const base = low.replace(/^[^a-zà-ÿ]+/, "").replace(/[^a-zà-ÿ]+$/, "");
  if (/^(.)\1+$/.test(low) || COMMON_PASSWORDS.has(low) || COMMON_PASSWORDS.has(base) || /^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(low)) {
    return "Questa password è troppo comune: scegline un'altra.";
  }
  const user = username.trim().toLowerCase();
  const mail = email.trim().toLowerCase().split("@")[0];
  if ((user.length >= 3 && low.includes(user)) || (mail.length >= 3 && low.includes(mail))) return "La password non può contenere il tuo nome utente o la tua email.";
  return "";
}
const RESERVED = ["admin", "administrator", "amministratore", "seeva", "supporto", "support", "staff", "moderatore", "moderator", "root", "sistema", "system", "ospite", "guest"];
function usernameProblem(u: string): string {
  if (u.length < 3 || u.length > 24) return "Il nome utente deve avere da 3 a 24 caratteri.";
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9._-]+( [A-Za-zÀ-ÖØ-öø-ÿ0-9._-]+)*$/.test(u)) return "Nel nome utente usa solo lettere, numeri, spazi e . _ -";
  if (RESERVED.includes(u.toLowerCase().replace(/[\s._-]/g, ""))) return "Questo nome utente non è disponibile: scegline un altro.";
  return "";
}
function birthDateProblem(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(String(iso) + "T12:00:00");
  if (isNaN(d.getTime()) || d.getFullYear() < 1900 || d > new Date()) return "Controlla la data di nascita.";
  const limit = new Date(); limit.setFullYear(limit.getFullYear() - 14);
  if (d > limit) return "Per registrarti a seeva devi avere almeno 14 anni.";
  return "";
}
// M4: massimo 10 registrazioni/tentativi ogni 15 minuti dallo stesso IP (in memoria).
const ipHits = new Map<string, number[]>();
function tooManyFromIp(req: Request, max = 10, windowMs = 15 * 60 * 1000): boolean {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const now = Date.now();
  const list = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  ipHits.set(ip, list);
  if (ipHits.size > 5000) ipHits.clear();
  return list.length > max;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const nome = (body.nome || "").trim() || null;
    const cognome = (body.cognome || "").trim() || null;
    const username = (body.username || "").trim();
    const email = (body.email || "").trim();
    const password = body.password || "";
    const dataNascita = body.dataNascita || null;
    const avatarUrl = body.avatarUrl || null;

    if (tooManyFromIp(req)) return errRes("Troppi tentativi: riprova tra qualche minuto.", 429);
    if (!username) return errRes("Il nome utente e' obbligatorio");
    if (!email) return errRes("L'email e' obbligatoria");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errRes("Controlla l'email.");
    const unProblem = usernameProblem(username);
    if (unProblem) return errRes(unProblem);
    if ((nome || "").length > 50 || (cognome || "").length > 50) return errRes("Nome e cognome possono avere al massimo 50 caratteri.");
    const bdProblem = birthDateProblem(dataNascita);
    if (bdProblem) return errRes(bdProblem);
    // Niente trim sulla password: si controlla esattamente quella che viene salvata.
    const pwProblem = passwordProblem(String(password), username, email);
    if (pwProblem) return errRes(pwProblem);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: existingUsername } = await admin.from("accounts").select("id").ilike("username", literal(username)).limit(1);
    if (existingUsername && existingUsername.length) return errRes("Questo nome utente e' gia' in uso");

    const { data: existingEmail } = await admin.from("accounts").select("id").ilike("email", literal(email)).limit(1);
    if (existingEmail && existingEmail.length) return errRes("Questa email e' gia' registrata");

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (createErr || !created || !created.user) {
      return errRes(createErr ? createErr.message : "Impossibile creare l'account");
    }

    const userId = created.user.id;

    const { data: profile, error: profileErr } = await admin
      .from("accounts")
      .insert({
        id: userId,
        nome,
        cognome,
        username,
        email,
        data_nascita: dataNascita,
        avatar_url: avatarUrl
      })
      .select("id, username, avatar_url")
      .single();

    if (profileErr || !profile) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return errRes(profileErr ? profileErr.message : "Impossibile salvare il profilo");
    }

    return new Response(JSON.stringify({ id: profile.id, username: profile.username, avatarUrl: profile.avatar_url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return errRes(String(err), 500);
  }
});
