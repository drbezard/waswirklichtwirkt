---
key: manus_review_publish
title: "Manus: Review + Veröffentlichung"
description: "Wie Manus den finalen DOI-Check macht und den polierten Artikel veröffentlicht"
version: 4
updated_at: 2026-04-26 20:00:00+00
synced_at: 2026-04-27T10:35:00.554Z
---
# Manus: Review + Veröffentlichung

Letzte Verteidigungslinie gegen Halluzinationen und Fehler.

## Wann du läufst

Wenn ein Topic Status `polished` hat.

## Workflow

1. Settings: `GET /api/manus/settings`. Bei pausiert → stop.
2. `polished` Topics: `GET /api/manus/topics?status=polished`
3. Pro Topic:

### a) Quellen validieren

- Jede `id` im Body (in `<div class="studie">`) muss in `sources:` existieren.
- Jede DOI live resolvable (HTTP 200/302 auf `https://doi.org/<doi>`).
- Fehlschlag → Topic zurück auf `drafted` mit Notiz.

### b) Frontmatter validieren

- Pflicht: `title`, `slug`, `date`, `category`, `excerpt`, `image`, `tags`
- Slug eindeutig (außer `type: refresh`)
- Tags alle aus `tags_vocabulary`

### c) HTML validieren

- Jede `<div class="studie">` geschlossen
- Kernaussage-Section vorhanden

### d) Hero-Bild hochladen (falls `image:` leer)

- 1600×900 px, fotorealistisch, ruhig, medizinisch-professionell
- Keine Patienten-Gesichter, keine blutigen Motive
- Format: PNG/JPG/WebP, max 5 MB

**Upload via Manus-API** (KEIN Service-Role-Key bei Manus nötig):

```
POST https://waswirktwirklich.vercel.app/api/manus/upload-image
Header: X-Manus-Token: <token>
Header: Origin: https://waswirktwirklich.vercel.app   ← Pflicht (CSRF-Schutz)
Body (multipart/form-data): slug=<slug>, file=<Bild>
```

Antwort 201 enthält `url` — direkt ins Frontmatter `image:` übernehmen.

### e) Veröffentlichen

1. `draft: true` entfernen
2. Datei verschieben: `src/content/drafts/<slug>.md` → `src/content/artikel/<slug>.md`
3. Commit:
   - `type=new`: `Publish: <titel>`
   - `type=revision`: `Update via Revision: <titel>`
   - `type=refresh`: `Refresh: <titel>`
4. Push auf `main` (Push-Rechte am Repo `drbezard/waswirktwirklich` nötig)

### f) Topic-Status

`POST /api/manus/topics/<id>/transition` mit
`{new_status: "published", article_slug: "<slug>", tags: [...]}`

Bei `type: refresh`: API ruft intern `publish_refresh()` auf — revoked alte
Verifikationen, Arzt muss neu verifizieren.

## Inline-Querverweise rückwirkend

Nach Publish: Repo nach Artikeln mit ≥2 gemeinsamen Tags. Pro Kandidat
prüfen, ob Verweis sinnvoll. Wenn ja: kleiner PR `Link added: <neu> from <alt>`.

## Verbote

- Kein Publish ohne komplette DOI-Verifikation
- Kein Slug-Konflikt (außer refresh)
- Kein Tag außerhalb Vokabular
- Bei pausierter Pipeline: nichts schreiben

