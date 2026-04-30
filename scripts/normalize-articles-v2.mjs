/**
 * Format-Vereinheitlichung der Bestands-Artikel (v2).
 *
 * Macht idempotent:
 *   1) Entfernt redundanten Titel/Meta-Block am Body-Anfang (kommt schon vom Renderer)
 *   2) Entfernt `===== N. SECTION =====`-Marker (Layout-Reste aus Manus-Templates)
 *   3) Entfernt `## Experten-Review`-Section (Reviewer kommt live aus Server-Island)
 *   4) Extrahiert `## Überprüfen Sie diesen Artikel selbst`-Prompt-Block in das
 *      Frontmatter-Feld `prompt`, entfernt den Block aus dem Body
 *   5) Entfernt `### Verwandte Artikel`-Block (Renderer macht related-articles via Tag-Jaccard)
 *   6) Entfernt `## Quellen`/`## Quellenverzeichnis`-Body-Liste, wenn `sources:` im
 *      Frontmatter steht
 *   7) Strippt nichtssagende Studientyp-Prefixe in `<span class="studie-name">`
 *   8) Setzt `prompt:` Frontmatter aus Standard-Vorlage, wenn fehlend oder generisch
 *      ("…von Manus AI…")
 *
 * Inhaltliche Substanz wird NICHT umgeschrieben.
 *
 * Usage:
 *   node scripts/normalize-articles-v2.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'artikel');
const DRY_RUN = process.argv.includes('--dry-run');

function defaultPrompt(title) {
  return `Du bist medizinischer Wissenschaftsjournalist für eine unabhängige, werbefreie Plattform. Du verkaufst nichts, hast keinen Interessenkonflikt und gibst ausschließlich wieder, was die Evidenz hergibt. Du bist extrem kritisch — wenn ein Verfahren in Studien nicht besser wirkt als Placebo, schreibst du das ohne Abschwächung.

Schreibe einen evidenzbasierten Patientenartikel auf Deutsch (Sie-Form, 2.500–3.500 Wörter) zum Thema:
**${title}**

Struktur:
(1) KERNAUSSAGE (max. 200 Wörter) — eine glasklare Aussage zur Evidenzlage, Hauptaussage zuerst, einfache Sprache.
(2) WAS PATIENTEN GLAUBEN — UND WAS DIE STUDIEN ZEIGEN (1.500–2.000 Wörter) — häufigste Patientenannahme vs. beste Evidenz; alle relevanten Cochrane-Reviews, Meta-Analysen und Leitlinien zum Thema mit Studienname, Erstautor, Journal, Jahr, Studiendesign, Teilnehmerzahl und Kernergebnis; Fachbegriffe sofort in Klammern erklären; erklären, warum Fehlvorstellungen bestehen (Placebo, Regression zur Mitte, finanzielle Anreize, widersprüchliche Leitlinien).
(3) WANN IST ES DOCH SINNVOLL? (300–400 Wörter) — konkrete Wenn-Dann-Kriterien, Notfall/dringend/elektiv unterscheiden, keine vagen Formulierungen.
(4) WAS SIE IHREN ARZT FRAGEN SOLLTEN (200–300 Wörter) — 5–7 konkrete Fragen mit Erklärung, warum sie wichtig sind.
(5) QUELLENVERZEICHNIS — nur Primärquellen: Cochrane Reviews, Meta-Analysen, RCTs, aktuelle Leitlinien führender Fachgesellschaften. Jede DOI muss unter https://doi.org/ resolvable sein.

Quellen-Anforderung: so viele Studien wie nötig, um die Evidenzlage abzudecken — keine fixe Zahl. Pflicht sind alle aktuellen Cochrane-Reviews, Meta-Analysen und Leitlinien zum Thema; RCTs nur, wenn keine Synthese existiert; Beobachtungsstudien nur als Ergänzung. Studien mit hoher Evidenzqualität haben Vorrang.

Stilregeln: Deutsch, Sie-Form. Direkt, kritisch, respektvoll — nie herablassend, nie alarmistisch, nie verharmlosend. Verboten: Marketingsprache, unbelegte Statistiken, Absolutismen ohne Evidenz, Empfehlungen ohne Studienbeleg, Verharmlosung von Risiken, Verteufelung evidenzbasierter Behandlungen. Gefordert: jede Behauptung mit Quelle, klare Unterscheidung zwischen „belegt"/„unklar"/„widerlegt"; bei widersprüchlicher Datenlage beide Seiten darstellen.

SEO: Titel max. 60 Zeichen mit Hauptkeyword vorne; Meta-Description max. 160 Zeichen mit Nutzen-Versprechen; H2/H3 mit Keyword-Variationen; einfache Sprache (verständlich für Klasse 9).

Qualitätskontrolle: jede medizinische Behauptung mit Quelle; Fachbegriffe erklärt. Ein Facharzt würde sagen „fair dargestellt", ein Patient „jetzt verstehe ich meine Optionen".`;
}

function isGenericPrompt(p) {
  if (!p || typeof p !== 'string') return true;
  const t = p.trim();
  if (t.length < 200) return true;
  return /Dieser Artikel wurde von Manus AI/i.test(t);
}

// String-basiertes Schneiden zwischen Markern (idiomatischer als regex mit \Z)
// Liefert {removed, kept} oder {removed:null, kept:body}.
function cutSection(body, startRegex, stopMarkers) {
  const startMatch = body.match(startRegex);
  if (!startMatch || startMatch.index === undefined) return { removed: null, kept: body };

  const start = startMatch.index;
  const after = start + startMatch[0].length;

  // Finde frühestes Vorkommen eines Stop-Markers ab `after`
  let stop = body.length;
  for (const stopRe of stopMarkers) {
    const tail = body.slice(after);
    const m = tail.match(stopRe);
    if (m && m.index !== undefined) {
      const pos = after + m.index;
      if (pos < stop) stop = pos;
    }
  }

  const removed = body.slice(start, stop);
  const kept = body.slice(0, start) + body.slice(stop);
  return { removed, kept };
}

function stripDuplicateHeader(body, title) {
  let out = body.replace(/^\s+/, '');
  const titlePattern = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out = out.replace(new RegExp('^##\\s+' + titlePattern + '\\s*\\n', 'i'), '');
  out = out.replace(
    /^Zuletzt aktualisiert:[\s\S]*?(?=\n(?:={5,}|## |<section\b|<div class="kernaussage"))/m,
    '',
  );
  return out.replace(/^\s+/, '');
}

function stripSectionMarkers(body) {
  return body.replace(/^={5,}[^\n]*={5,}\s*\n/gm, '');
}

function stripExpertenReview(body) {
  // Vom `## Experten-Review` bis zum nächsten `^## ` (oder Body-Ende)
  const { kept } = cutSection(
    body,
    /^## Experten-Review\b[^\n]*\n/m,
    [/\n## (?!Experten-Review)/m],
  );
  return kept;
}

// Liefert {body, extracted}: extracted = nur der Prompt-Text zur Übernahme ins Frontmatter
function extractAndStripPromptBlock(body) {
  // Heading-Varianten erfassen
  const headingRe = /^## (?:Überprüfen Sie diesen Artikel selbst|Diesen Artikel selbst überprüfen|KI-Prompt|Überprüfungs-Prompt)\b[^\n]*\n/m;
  const startMatch = body.match(headingRe);
  if (!startMatch) return { body, extracted: null };

  const start = startMatch.index;
  const after = start + startMatch[0].length;

  // Stop bei nächstem `## ` oder `### Verwandte Artikel` oder Body-Ende
  const tail = body.slice(after);
  const stopAt = (() => {
    const candidates = [];
    const m1 = tail.match(/\n## /m);
    if (m1) candidates.push(after + m1.index + 1);
    const m2 = tail.match(/\n### Verwandte Artikel\b/m);
    if (m2) candidates.push(after + m2.index + 1);
    return candidates.length ? Math.min(...candidates) : body.length;
  })();

  const block = body.slice(after, stopAt);
  const cleaned = body.slice(0, start) + body.slice(stopAt);

  // Aus dem Block den eigentlichen Prompt-Text extrahieren:
  // Ab "Du bist…" bis zum Ende des Blocks, abzüglich abschließender Kontroll-Sätze.
  let extracted = null;
  const promptStart = block.search(/Du bist\b/);
  if (promptStart !== -1) {
    let promptText = block.slice(promptStart);
    // Anhängende Hinweis-Sätze entfernen
    promptText = promptText.replace(/\n+Ergänzung des prüfenden Facharztes:[\s\S]*$/, '');
    promptText = promptText.replace(/\n+Wir glauben an Transparenz[\s\S]*$/, '');
    extracted = promptText.trim();
  }

  return { body: cleaned, extracted };
}

function stripVerwandteArtikel(body) {
  // Vom `### Verwandte Artikel` bis nächstes h2/h3 oder Body-Ende
  const { kept } = cutSection(
    body,
    /^### Verwandte Artikel\b[^\n]*\n/m,
    [/\n## /m, /\n### (?!Verwandte Artikel)/m],
  );
  return kept;
}

function stripBodyQuellen(body) {
  // Body-Heading "## Quellen" ODER "## Quellenverzeichnis" — bis nächstes h2 oder EOF
  let out = body;
  for (const re of [/^## Quellen\b[^\n]*\n/m, /^## Quellenverzeichnis\b[^\n]*\n/m]) {
    const result = cutSection(out, re, [/\n## /m]);
    out = result.kept;
  }
  return out;
}

const GENERIC_STUDIE_PREFIXES = [
  'Beobachtungsstudie',
  'Kohortenstudie',
  'Prospektive Kohortenstudie',
  'Retrospektive Kohortenstudie',
  'Prospektive Studie',
  'Retrospektive Studie',
  'Studie',
  'Querschnittsstudie',
  'Fall-Kontroll-Studie',
  'Längsschnittstudie',
];
function normalizeStudienNamen(body) {
  return body.replace(
    /(<span class="studie-name">)([^<]+)(<\/span>)/g,
    (full, open, name, close) => {
      for (const prefix of GENERIC_STUDIE_PREFIXES) {
        const re = new RegExp('^' + prefix + ':\\s*', 'i');
        if (re.test(name)) {
          return `${open}${name.replace(re, '')}${close}`;
        }
      }
      return full;
    },
  );
}

function tidyWhitespace(body) {
  return body
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^[\s\n]+/, '')
    .replace(/[\s\n]+$/, '\n');
}

// ---------------------------------------------------------------------------

const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
let totalChanged = 0;
const reports = [];

for (const file of files) {
  const path = join(ARTICLES_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const parsed = matter(raw);

  const before = parsed.content;
  let body = parsed.content;

  body = stripDuplicateHeader(body, parsed.data.title || '');
  body = stripSectionMarkers(body);
  body = stripExpertenReview(body);

  const { body: bodyAfterPrompt, extracted } = extractAndStripPromptBlock(body);
  body = bodyAfterPrompt;

  body = stripVerwandteArtikel(body);

  const hasStructuredSources =
    Array.isArray(parsed.data.sources) && parsed.data.sources.length > 0;
  if (hasStructuredSources) {
    body = stripBodyQuellen(body);
  }

  body = normalizeStudienNamen(body);
  body = tidyWhitespace(body);

  const fmChanges = [];
  const currentPrompt = parsed.data.prompt;
  let nextPrompt = currentPrompt;
  if (extracted && extracted.length > 200) {
    nextPrompt = extracted;
    fmChanges.push('prompt ← extrahiert aus Body');
  } else if (isGenericPrompt(currentPrompt)) {
    nextPrompt = defaultPrompt(parsed.data.title || file);
    fmChanges.push(currentPrompt ? 'prompt ← Vorlage (war generisch)' : 'prompt ← Vorlage (fehlte)');
  }
  if (nextPrompt !== currentPrompt) parsed.data.prompt = nextPrompt;

  const bodyChanged = body !== before;
  const fmChanged = fmChanges.length > 0;

  if (!bodyChanged && !fmChanged) {
    reports.push({ file, status: 'unchanged' });
    continue;
  }

  const out = matter.stringify(body, parsed.data);
  if (!DRY_RUN) writeFileSync(path, out);

  totalChanged++;
  reports.push({
    file,
    status: 'changed',
    body: bodyChanged ? `body ${before.length}→${body.length} (${body.length - before.length})` : null,
    fm: fmChanges.length ? fmChanges.join(', ') : null,
  });
}

console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}Bearbeitet: ${totalChanged} von ${files.length}\n`);
for (const r of reports) {
  if (r.status === 'unchanged') {
    console.log(`  ⊙ ${r.file}`);
  } else {
    console.log(`  ✓ ${r.file}`);
    if (r.body) console.log(`      ${r.body}`);
    if (r.fm) console.log(`      fm: ${r.fm}`);
  }
}
