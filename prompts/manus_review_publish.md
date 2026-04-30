---
key: manus_review_publish
title: "Manus: Review + Veröffentlichung"
description: "Wie Manus den finalen DOI-Check macht und den polierten Artikel veröffentlicht"
version: 5
updated_at: 2026-04-30 09:00:00.000000+00
synced_at: 2026-04-30T09:00:00.000Z
---
# Manus: Review + Veröffentlichung

Letzte Verteidigungslinie gegen Halluzinationen, Format-Drift und Quellen-Lücken.

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

- Pflicht: `title`, `slug`, `date`, `category`, `excerpt`, `image`, `tags`, `prompt`,
  `seoTitle`, `seoDescription`
- `category:` exakt aus erlaubter Fachgebiete-Liste (siehe Drafting-Prompt)
- Slug eindeutig (außer `type: refresh`)
- Tags alle aus `tags_vocabulary`
- `prompt:` darf NICHT generisch sein. Verwerfen wenn:
  - leer oder kürzer als 200 Zeichen
  - enthält die Phrase „Dieser Artikel wurde von Manus AI" oder „basierend auf den
    aktuellsten wissenschaftlichen Studien"
  - enthält nicht mindestens einen Anker, der den Artikel-Titel oder eine konkrete
    Schlüsselstudie aus dem Artikel referenziert

### c) Body-Format validieren

- Jede `<div class="studie">` geschlossen
- Kernaussage-Section vorhanden (`<section class="kernaussage">`)
- **Verboten** im Body (Auto-Reject + zurück auf `drafted`):
  - `===== ` oder `===== INTERNE VERLINKUNG =====` und ähnliche Marker
  - Heading `## Quellen` oder `## Quellenverzeichnis` (Quellen kommen aus `sources:`)
  - Heading `## Experten-Review` (Reviewer kommt live aus Server-Island)
  - Heading `## Überprüfen Sie diesen Artikel selbst` oder „Diesen Artikel selbst
    überprüfen" (kommt vom Renderer aus `prompt:`)
  - Heading `### Verwandte Artikel` (kommt vom Renderer aus Tag-Jaccard)
  - Reviewer-Platzhalter wie „[Platz für ein 1–2-Satz-Statement des Reviewers …]" oder
    „### Ergänzung des prüfenden Facharztes"

### d) Studien-Box-Headlines validieren

Jeder `<span class="studie-name">…</span>` muss mit einem **Eigennamen** beginnen, nicht
mit einem generischen Studientyp-Prefix. Verboten als Anfang:
- `Beobachtungsstudie:`
- `Kohortenstudie:`
- `Prospektive Kohortenstudie:`
- `Studie:`
- `RCT:`

Erlaubt sind: Autor-Form (`Lax et al. (2024) — …`), Org-Form (`AAD Clinical Practice
Guideline (2024)`), Report-Form (`TFOS DEWS II Management and Therapy Report (2017)`).

Bei Verletzung → Topic zurück auf `drafted` mit Notiz, welche Box.

### e) Hero-Bild hochladen (falls `image:` leer)

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

### f) Veröffentlichen

1. `draft: true` entfernen
2. Datei verschieben: `src/content/drafts/<slug>.md` → `src/content/artikel/<slug>.md`
3. Commit:
   - `type=new`: `Publish: <titel>`
   - `type=revision`: `Update via Revision: <titel>`
   - `type=refresh`: `Refresh: <titel>`
4. Push auf `main` (Push-Rechte am Repo `drbezard/waswirktwirklich` nötig)

### g) Topic-Status

`POST /api/manus/topics/<id>/transition` mit
`{new_status: "published", article_slug: "<slug>", tags: [...]}`

Bei `type: refresh`: API ruft intern `publish_refresh()` auf — revoked alte
Verifikationen, Arzt muss neu verifizieren.

## Inline-Querverweise rückwirkend

Nach Publish: Repo nach Artikeln mit ≥2 gemeinsamen Tags. Pro Kandidat
prüfen, ob Verweis sinnvoll. Wenn ja: kleiner PR `Link added: <neu> from <alt>`.

## Verbote

- Kein Publish ohne komplette DOI-Verifikation
- Kein Publish bei generischem `prompt:`-Feld
- Kein Publish bei verbotenen Body-Sections (siehe c)
- Kein Slug-Konflikt (außer refresh)
- Kein Tag außerhalb Vokabular
- Bei pausierter Pipeline: nichts schreiben
