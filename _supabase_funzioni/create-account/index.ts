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

   Password minimo 8 caratteri (Fil, 2026-07-12): niente regole su caratteri
   speciali/maiuscole, solo una lunghezza minima decente. Controllata anche
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

    if (!username) return errRes("Il nome utente e' obbligatorio");
    if (!email) return errRes("L'email e' obbligatoria");
    if (!password || password.trim().length < 8) return errRes("La password deve avere almeno 8 caratteri");

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
