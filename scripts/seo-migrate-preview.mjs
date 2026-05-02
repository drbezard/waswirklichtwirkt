/**
 * Generiert eine reviewbare Vorschau-Tabelle der SEO-Migrations-Vorschläge.
 *
 * KEINE Schreibvorgänge an Artikel-Frontmatter. Output ist nur:
 *   docs/seo-migration-preview.md
 *
 * Pro Bestandsartikel werden vorgeschlagen:
 *   - seoTitle (max 60 Z., Hauptkeyword vorne)
 *   - seoDescription (140-160 Z., Befund + Zahl + Konsequenz)
 *   - mainKeyword
 *   - secondaryKeywords (2-4)
 *   - faqItems (regex-extrahiert aus "Was Sie Ihren Arzt fragen sollten")
 *
 * Die Text-Vorschläge (Title/Description/Keywords) werden mit Claude
 * generiert — der Volltext jedes Artikels gibt der KI den Kontext für
 * konkrete Zahlen, Studiennamen und Befunde.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/seo-migrate-preview.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'artikel');
const DOCS_DIR = join(__dirname, '..', 'docs');
const OUT_PATH = join(DOCS_DIR, 'seo-migration-preview.md');

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY env-var fehlt.');
  process.exit(1);
}

const client = new Anthropic({ apiKey });

// FAQ-Extraktion aus dem Body — robust gegen Bold-/Quote-/Separator-Varianten.
//
// Akzeptierte Formen pro Bullet:
//   - **„Frage?"**  Antwort.
//   - „Frage?"  ⏎  Antwort.   (Markdown-Linebreak)
//   - „Frage?"Antwort.        (kein Separator)
//   - **Frage?**  Antwort.    (kein Quotes)
//
// Quote-Charakter-Klasse (German + English + straight). Unicode-escapes
// vermeiden Konflikt mit JS-String-Delimitern.
//   U+201E „   U+201C "   U+201D "   U+0022 "   U+2018 '   U+2019 '   U+0027 '
const QUOTE_CHARS = String.fromCharCode(0x201E, 0x201C, 0x201D, 0x22, 0x2018, 0x2019, 0x27);
const LEAD_QUOTE = new RegExp('^[' + QUOTE_CHARS + ']+');
const TRAIL_QUOTE = new RegExp('[' + QUOTE_CHARS + ']+$');

function extractFaqItems(body) {
  if (!body) return [];
  const headingMatch = body.match(/^#{2,3}[^\n]*[Ff]ragen[^\n]*$/m);
  if (!headingMatch || headingMatch.index === undefined) return [];
  const afterHeading = body.slice(headingMatch.index + headingMatch[0].length);
  const endMatch = afterHeading.match(/\n## /);
  const section = endMatch ? afterHeading.slice(0, endMatch.index) : afterHeading;

  // Bullets zusammenführen — Continuation-Lines (nicht-Bullet, nicht-Heading) anhängen
  const items = [];
  let current = null;
  for (const line of section.split('\n')) {
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      if (current) items.push(current);
      current = bullet[1];
    } else if (current !== null && line.trim() && !/^#{1,3}\s/.test(line) && !/^---/.test(line)) {
      current += '\n' + line.trim();
    }
  }
  if (current) items.push(current);

  const faqs = [];
  for (const raw of items) {
    let work = raw.trim();
    // Führende Bold/Quote-Marker entfernen (mehrfach, in beiden Reihenfolgen möglich)
    for (let i = 0; i < 3; i++) {
      work = work.replace(/^\*+\s*/, '').replace(LEAD_QUOTE, '');
    }
    // Frage = bis einschließlich erstem "?"
    const qMatch = work.match(/^([^?]+\?)/);
    if (!qMatch) continue;
    let question = qMatch[1].trim();
    // Frage: trailing Quotes/Bold mehrfach abräumen
    for (let i = 0; i < 3; i++) {
      question = question.replace(/\*+$/, '').replace(TRAIL_QUOTE, '').trim();
    }
    let answer = work.slice(qMatch[0].length).trim();
    // Antwort: führende Quotes/Bold/em-dash mehrfach abräumen
    for (let i = 0; i < 3; i++) {
      answer = answer
        .replace(LEAD_QUOTE, '')
        .replace(/^\*+\s*/, '')
        .replace(/^[—\-]\s*/, '')
        .trim();
    }
    // Bold-Marker im Antworttext kosmetisch entfernen
    answer = answer.replace(/\*\*/g, '');
    if (question.length > 5 && answer.length > 15) {
      faqs.push({ question, answer });
    }
  }
  return faqs;
}

const SYSTEM_PROMPT = `Du bist SEO-Redakteur für eine evidenzbasierte deutsche Medizin-Plattform. Liefere für einen gegebenen Artikel präzise SEO-Felder als striktes JSON ohne Markdown-Codeblock.

Regeln:
- seoTitle: max 60 Zeichen (zähl mit). Hauptkeyword vorne. Patienten-Suchverhalten beachten — kürzere, gebräuchliche Bezeichnungen bevorzugen (z.B. "LASIK" statt "Augenlaser-Operation"; "MRT bei Rückenschmerzen" statt "Bildgebung").
- seoDescription: 140-160 Zeichen. Erst Befund mit konkreter Zahl/Effektgröße/Studie, dann Konsequenz. Kein Marketing-Sprech, kein "endlich", "wirklich", "umfassend". Endet ohne Floskel.
- mainKeyword: das eine Keyword, nach dem Patienten googeln. 2-4 Wörter.
- secondaryKeywords: 2-4 Synonyme oder verwandte Begriffe (z.B. medizinische Fachausdrücke, Wirkstoff-Klassen).

Gib AUSSCHLIESSLICH gültiges JSON zurück, ohne Einleitung:
{
  "seoTitle": "…",
  "seoDescription": "…",
  "mainKeyword": "…",
  "secondaryKeywords": ["…", "…"]
}`;

function userPrompt(file, data, bodyExcerpt) {
  return `Datei: ${file}
Aktueller Titel: "${data.title}"
Kategorie: ${data.category}
Tags: ${(data.tags || []).join(', ')}
Aktuelles Excerpt (${data.excerpt?.length ?? 0} Z.): "${data.excerpt || '(leer)'}"

Body-Auszug:
${bodyExcerpt}

Generiere die SEO-Felder als JSON.`;
}

async function suggestForArticle(file, data, body) {
  const bodyExcerpt = body.slice(0, 6000);
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: userPrompt(file, data, bodyExcerpt) },
    ],
  });

  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  let cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------

const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md')).sort();
console.error(`Generiere Vorschläge für ${files.length} Artikel …`);

const rows = [];
for (const file of files) {
  const path = join(ARTICLES_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const { data, content } = matter(raw);
  if (data.draft) continue;

  process.stderr.write(`  · ${file} …`);
  let suggestion;
  try {
    suggestion = await suggestForArticle(file, data, content);
  } catch (err) {
    process.stderr.write(' FEHLER\n');
    console.error('   ', err.message);
    suggestion = { seoTitle: '(Fehler)', seoDescription: '(Fehler)', mainKeyword: '', secondaryKeywords: [] };
  }
  const faqItems = extractFaqItems(content);
  process.stderr.write(` ✓ (faq=${faqItems.length})\n`);

  rows.push({ file, data, suggestion, faqItems });
}

// ---------------------------------------------------------------------------
// Markdown-Output
// ---------------------------------------------------------------------------

if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });

const lines = [];
lines.push('# SEO-Migrations-Vorschau');
lines.push('');
lines.push('Generiert von `scripts/seo-migrate-preview.mjs`. KEINE Frontmatter geschrieben.');
lines.push('');
lines.push('Bitte pro Artikel reviewen. Korrekturen direkt in dieser Datei (oder im PR-Comment) markieren — danach läuft `seo-migrate-apply.mjs` mit den freigegebenen Werten.');
lines.push('');
lines.push(`**Stand:** ${rows.length} Artikel, alle aus \`src/content/artikel/\`.`);
lines.push('');
lines.push('---');
lines.push('');

for (const row of rows) {
  const { file, data, suggestion, faqItems } = row;
  const titleLen = [...(data.title || '')].length;
  const seoTitleLen = [...(suggestion.seoTitle || '')].length;
  const seoDescLen = [...(suggestion.seoDescription || '')].length;
  const excerptLen = [...(data.excerpt || '')].length;

  lines.push(`### ${file}`);
  lines.push('');
  lines.push(`- **Aktueller Titel** (${titleLen}): "${data.title}"`);
  lines.push(`- **Vorschlag seoTitle** (${seoTitleLen}): "${suggestion.seoTitle}"`);
  lines.push(`- **mainKeyword**: "${suggestion.mainKeyword}"`);
  const secList = (suggestion.secondaryKeywords || []).map((k) => `"${k}"`).join(', ');
  lines.push(`- **secondaryKeywords**: [${secList}]`);
  lines.push(`- **Aktuelles excerpt** (${excerptLen}): "${data.excerpt}"`);
  lines.push(`- **Vorschlag seoDescription** (${seoDescLen}): "${suggestion.seoDescription}"`);
  lines.push(`- **faqItems**: ${faqItems.length} extrahiert${faqItems.length > 0 ? '' : ' — bitte prüfen ob die Sektion existiert'}`);
  if (faqItems.length > 0) {
    lines.push('  <details><summary>FAQ-Vorschau</summary>');
    lines.push('');
    for (const f of faqItems) {
      const q = f.question.length > 90 ? f.question.slice(0, 87) + '…' : f.question;
      const a = f.answer.length > 140 ? f.answer.slice(0, 137) + '…' : f.answer;
      lines.push(`  - **${q}**`);
      lines.push(`    ${a}`);
    }
    lines.push('  </details>');
  }
  lines.push('');
}

writeFileSync(OUT_PATH, lines.join('\n'));
console.error(`\nGeschrieben: ${OUT_PATH}`);
