-- A1 parte 2 (audit 26/11/2026) - NON applicato.
-- Quando nessuno usa piu' la 1.0 (che carica la foto profilo PRIMA di creare l'account),
-- anche le foto profilo si potranno caricare solo da utenti collegati (dalla 1.0.1 la foto
-- si carica dopo l'accesso, vedi createAccount in data.js).
alter policy "Avatars anon upload" on storage.objects to authenticated
  with check (bucket_id = 'avatars' and name like 'avatar-%' and position('/' in name) = 0
    and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','heic','heif','gif'));
-- ROLLBACK: stessa riga con "to anon, authenticated".
