import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/* Funzione di prova del 2026-07-19 (test chiavi VAPID), DISATTIVATA il
   2026-10-14 nella revisione sicurezza: era aperta a tutti e mandava una
   push a qualsiasi account dato lo username. Ora risponde e basta.
   Si può cancellare del tutto dal pannello Supabase (Edge Functions ->
   notify-test-push -> Delete). */
Deno.serve(() => new Response(JSON.stringify({ error: "funzione disattivata" }), { status: 410, headers: { "Content-Type": "application/json" } }));
