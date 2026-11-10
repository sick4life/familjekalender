# Familjekalender

Familjens väggkalender: veckovy, sysslor med upprepning, poäng per person, bildspel och nattdimning.

- Sidan är statisk (GitHub Pages). All data ligger i Supabase bakom inloggning.
- Kalendern synkas åt båda håll med Google Kalender via `supabase/functions/calendar`.
- iCloud-kalendrar kan visas skrivskyddat via sin delningslänk.
- Bilder till bildspelet sparas bara lokalt på enheten.

Installation: kör `supabase/setup.sql` i Supabase SQL Editor, lägg upp funktionen `calendar`
med hemligheterna `GOOGLE_CLIENT_ID` och `GOOGLE_CLIENT_SECRET`, och fyll i `js/config.js`.
