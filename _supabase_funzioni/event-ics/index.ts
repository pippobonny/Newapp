import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* "Aggiungi al calendario" su iPhone (2026-10-04). Un indirizzo vero che
   risponde text/calendar: iOS mostra da solo "Aggiungi a Calendario".
   Pubblica (verify_jwt false): dà solo ciò che get_event_public già mostra.
   GET ?id=<evento>[&date=YYYY-MM-DD][&lang=en] (lang: 2026-10-07) */

function pad(n: number) { return (n < 10 ? "0" : "") + n; }
function esc(s: string) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const wantedDate = url.searchParams.get("date") || "";
  const en = url.searchParams.get("lang") === "en";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(en ? "Invalid id" : "id non valido", { status: 400 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ev } = await admin.from("events")
    .select("id, name, description, event_time, location_address, confirmed_date_option_id, confirmed_location_option_id")
    .eq("id", id).maybeSingle();
  if (!ev) return new Response(en ? "Event not found" : "Evento non trovato", { status: 404 });

  const { data: opts } = await admin.from("date_options").select("id, date_iso").eq("event_id", id);
  const options = (opts || []) as { id: string; date_iso: string }[];
  let dateISO = "";
  if (wantedDate && options.some((o) => o.date_iso === wantedDate)) dateISO = wantedDate;
  if (!dateISO && ev.confirmed_date_option_id) dateISO = options.find((o) => o.id === ev.confirmed_date_option_id)?.date_iso || "";
  if (!dateISO && options.length === 1) dateISO = options[0].date_iso;
  if (!dateISO) return new Response(en ? "Date not decided yet" : "Data non ancora decisa", { status: 409 });

  let location = ev.location_address || "";
  if (ev.confirmed_location_option_id) {
    const { data: lo } = await admin.from("location_options").select("address").eq("id", ev.confirmed_location_option_id).maybeSingle();
    if (lo?.address) location = lo.address;
  }

  const datePart = dateISO.replace(/-/g, "");
  let dt: string[];
  if (ev.event_time) {
    const [h, m] = String(ev.event_time).split(":").map(Number);
    const end = new Date(Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10), h + 1, m));
    const endStr = end.getUTCFullYear() + pad(end.getUTCMonth() + 1) + pad(end.getUTCDate()) + "T" + pad(end.getUTCHours()) + pad(end.getUTCMinutes()) + "00";
    dt = ["DTSTART;TZID=Europe/Rome:" + datePart + "T" + pad(h) + pad(m) + "00", "DTEND;TZID=Europe/Rome:" + endStr];
  } else {
    const next = new Date(Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10) + 1));
    dt = ["DTSTART;VALUE=DATE:" + datePart, "DTEND;VALUE=DATE:" + next.getUTCFullYear() + pad(next.getUTCMonth() + 1) + pad(next.getUTCDate())];
  }
  const now = new Date();
  const stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + "T" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + "Z";
  const desc = [ev.description || "", (en ? "Details on seeva: " : "Dettagli su seeva: ") + "https://seeva.it/evento.html?id=" + ev.id].filter(Boolean).join("\n\n");

  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//seeva//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:Europe/Rome",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT", "UID:" + ev.id + "@seeva.it", "DTSTAMP:" + stamp, ...dt,
    "SUMMARY:" + esc(ev.name),
    ...(location ? ["LOCATION:" + esc(location)] : []),
    "DESCRIPTION:" + esc(desc),
    "URL:https://seeva.it/evento.html?id=" + ev.id,
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold);

  const safe = (ev.name || "evento").replace(/[^\w\- ]/g, "").trim() || "evento";
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="' + safe + '.ics"',
      "Cache-Control": "no-store",
    },
  });
});
