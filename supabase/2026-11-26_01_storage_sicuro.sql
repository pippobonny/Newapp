-- A1 (audit 26/11/2026) - Storage foto/audio piu' sicuro. APPLICATA il 26/11/2026.
-- Compatibile con l'app 1.0 (build 26):
--  * event-photos / event-audio: caricano solo utenti collegati (gli eventi si creano solo con account).
--  * avatars: resta aperto anche a chi non e' collegato SOLO perche' la 1.0 carica la foto profilo
--    PRIMA di creare l'account (registrazione). Dalla 1.0.1 la foto si carica dopo l'accesso:
--    quando la 1.0 non sara' piu' in giro, applicare 2026-11-26_futuro_avatars_solo_autenticati.sql.
--  * niente piu' UPDATE: nessuno puo' sovrascrivere un file (l'app usa gia' upsert:false).
--  * solo immagini/audio, massimo 10 MB, nomi come quelli generati dall'app, niente sottocartelle.

update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']
  where id in ('avatars','event-photos');
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/aac','audio/x-m4a','audio/m4a','audio/wav']
  where id = 'event-audio';

-- Nota: il client MCP annulla i DROP, quindi le policy esistenti sono state MODIFICATE (alter policy),
-- non cancellate. I nomi restano quelli vecchi ("... anon ...") ma il contenuto ora e' questo:
alter policy "Avatars anon update" on storage.objects to public using (false) with check (false);
alter policy "Event photos anon update" on storage.objects to public using (false) with check (false);
alter policy "Event audio anon update" on storage.objects to public using (false) with check (false);
alter policy "Avatars anon upload" on storage.objects to anon, authenticated
  with check (bucket_id = 'avatars' and name like 'avatar-%' and position('/' in name) = 0
    and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','heic','heif','gif'));
alter policy "Event photos anon upload" on storage.objects to authenticated
  with check (bucket_id = 'event-photos' and name like 'event-%' and position('/' in name) = 0
    and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','heic','heif','gif'));
alter policy "Event audio anon upload" on storage.objects to authenticated
  with check (bucket_id = 'event-audio' and name like 'event-audio-%' and position('/' in name) = 0
    and lower(storage.extension(name)) in ('webm','m4a','ogg','mp4','mp3','aac','wav'));

-- ROLLBACK (per tornare esattamente a prima):
-- update storage.buckets set file_size_limit = null, allowed_mime_types = null where id in ('avatars','event-photos','event-audio');
-- alter policy "Avatars anon upload" on storage.objects to public with check (bucket_id = 'avatars');
-- alter policy "Avatars anon update" on storage.objects to public using (bucket_id = 'avatars') with check (true);
-- alter policy "Event photos anon upload" on storage.objects to public with check (bucket_id = 'event-photos');
-- alter policy "Event photos anon update" on storage.objects to public using (bucket_id = 'event-photos') with check (true);
-- alter policy "Event audio anon upload" on storage.objects to public with check (bucket_id = 'event-audio');
-- alter policy "Event audio anon update" on storage.objects to public using (bucket_id = 'event-audio') with check (true);
