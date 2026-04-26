---
key: manus_review_publish
title: "Manus: Review + Veröffentlichung"
description: "Wie Manus den finalen DOI-Check macht und den polierten Artikel veröffentlicht"
version: 2
updated_at: 2026-04-26 16:10:51.023033+00
synced_at: 2026-04-26T17:21:27.764Z
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

- Jede `id` im Body (in `<div class="studie">` oder zitiert) muss in `sources:` existieren.
- Jede DOI in `sources:` muss live resolvable sein (HTTP 200/302 auf `https://doi.org/<doi>`).
- Bei Fehlschlag → Topic zurück auf `drafted` mit präziser Notiz, kein Publish.

### b) Frontmatter validieren

- Pflichtfelder: `title`, `slug`, `date`, `category`, `excerpt`, `image`, `tags`
- Slug eindeutig (außer `type: refresh` mit passendem `article_slug`)
- Tags alle aus `tags_vocabulary`

### c) HTML validieren

- Jede `<div class="studie">` geschlossen
- Kernaussage-Section vorhanden
- Keine offenen Tags

### d) Hero-Bild generieren (falls `image:` leer)

- 1600×900 px, fotorealistisch, ruhig, medizinisch-professionell
- Keine Patienten-Gesichter, keine blutigen/chirurgischen Motive
- Hochladen zu Supabase Storage:
  `POST https://qyaivjcczncckifsrrps.supabase.co/storage/v1/object/article-images/<slug>.png`
  Header: `Authorization: Bearer <SERVICE_ROLE_KEY>`, `Content-Type: image/png`, `x-upsert: true`
- URL ins Frontmatter: `image: "https://qyaivjcczncckifsrrps.supabase.co/storage/v1/object/public/article-images/<slug>.png"`

### e) Veröffentlichen

1. `draft: true` aus Frontmatter entfernen
2. Datei verschieben: `src/content/drafts/<slug>.md` → `src/content/artikel/<slug>.md`
   - Bei `type: refresh`: bestehende Datei direkt überschreiben
3. Commit mit Message:
   - `type=new`:      `Publish: <titel>`
   - `type=revision`: `Update via Revision: <titel>`
   - `type=refresh`:  `Refresh: <titel>`
4. Push

### f) Topic-Status auf `published`

`POST /api/manus/topics/<id>/transition` mit
`{new_status: "published", article_slug: "<slug>", tags: [...]}`

Bei `type: refresh` ruft die API intern `publish_refresh()` auf — das revoked die alten
Verifikationen und zählt `refresh_count` hoch. Der Arzt muss neu verifizieren.

## Inline-Querverweise rückwirkend

Nach erfolgreichem Publish: Suche im Repo nach Artikeln mit ≥2 gemeinsamen Tags.
Pro Kandidat prüfe, ob ein Inline-Verweis sinnvoll ist. Wenn ja: kleinen PR öffnen
`Link added: <neuer-slug> from <alter-slug>`.

## Verbote

- Kein Publish ohne komplette DOI-Verifikation
- Kein Publish bei Slug-Konflikt (außer refresh)
- Kein Tag außerhalb des Vokabulars
- Bei pausierter Pipeline: nichts pushen

