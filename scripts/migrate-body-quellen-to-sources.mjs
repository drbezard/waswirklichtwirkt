/**
 * Migration: Body-Quellen-Listen → strukturiertes `sources:` Frontmatter.
 *
 * Bestandsartikel haben ihre Quellen am Ende als Markdown-Liste im Body. Der
 * Renderer hat nur dann eine ordentliche Quellen-Anzeige (mit Titel-Link, DOI,
 * Journal-Detailzeile, Evidenz-Badge), wenn die Quellen strukturiert im
 * Frontmatter stehen.
 *
 * Dieses Skript parst die Body-Liste, baut daraus `sources:`-Objekte und
 * entfernt anschließend die Body-Liste.
 *
 * Usage:
 *   node scripts/migrate-body-quellen-to-sources.mjs --dry-run
 *   node scripts/migrate-body-quellen-to-sources.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'artikel');
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

function findQuellenSection(body) {
  const headRe = /^## (?:Quellen|Quellenverzeichnis)\b[^\n]*\n/m;
  const headMatch = body.match(headRe);
  if (!headMatch) return null;
  const start = headMatch.index;
  const after = start + headMatch[0].length;

  // Stop am nächsten ^## / ^# Heading oder Body-Ende
  const tail = body.slice(after);
  const stopRel = (() => {
    const m1 = tail.match(/\n## /);
    const m2 = tail.match(/\n# /);
    const candidates = [];
    if (m1) candidates.push(m1.index + 1);
    if (m2) candidates.push(m2.index + 1);
    return candidates.length ? Math.min(...candidates) : tail.length;
  })();

  const end = after + stopRel;
  const listText = body.slice(after, end);
  return { fullMatch: body.slice(start, end), listText, start, end };
}

function extractListItems(listText) {
  // Items beginnen mit "- " am Zeilenanfang. Mehrzeilige Items werden zusammengeführt.
  const items = [];
  let current = null;
  for (const line of listText.split('\n')) {
    if (/^-\s+/.test(line)) {
      if (current) items.push(current.trim());
      current = line.replace(/^-\s+/, '');
    } else if (current && line.trim()) {
      current += ' ' + line.trim();
    } else if (line.trim() === '' && current) {
      items.push(current.trim());
      current = null;
    }
  }
  if (current) items.push(current.trim());
  return items.filter((s) => s.length > 0);
}

function detectType(text) {
  const t = text.toLowerCase();
  if (/cochrane/.test(t)) return { type: 'cochrane', quality: 'high' };
  if (/network meta-analysis|netzwerk-meta-analyse/.test(t)) return { type: 'meta-analysis', quality: 'high' };
  if (/systematic review and meta-analysis|systematische übersicht.*meta-analyse|meta-analysis|meta-analyse/.test(t)) {
    return { type: 'meta-analysis', quality: 'high' };
  }
  if (/systematic review|systematische übersicht/.test(t)) return { type: 'meta-analysis', quality: 'high' };
  if (/clinical practice guideline|leitlinie|guideline|s3-leitlinie|s2k-leitlinie|nice (?:guidance|ng\d+)|awmf/.test(t)) {
    return { type: 'guideline', quality: 'high' };
  }
  if (/\brandomized\b|\brct\b|\bdouble.blind\b|placebo.controlled/.test(t)) {
    return { type: 'rct', quality: 'medium' };
  }
  if (/cohort study|kohortenstudie|prospective.*population|population based study/.test(t)) {
    return { type: 'observational', quality: 'medium' };
  }
  return {};
}

function makeId(authors, year, taken) {
  const firstAuthor = (authors || 'unknown')
    .split(/[,;]/)[0]
    .replace(/\s*\(.+\)\s*/g, '')
    .replace(/\s+et\s+al\.?$/i, '')
    .trim()
    .split(/\s+/)
    .pop()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]/g, '');
  let base = `${firstAuthor || 'src'}-${year || 'na'}`;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  taken.add(`${base}-${i}`);
  return `${base}-${i}`;
}

function parseLine(raw, taken) {
  let line = raw.trim();

  // Markdown-Marker am Rand entfernen: führende/trailing * oder ** oder __
  line = line.replace(/^[*_]+/, '').replace(/[*_]+$/, '');
  // Innere bold/italic-Marker um Autor-Block: **…** oder *…*
  line = line.replace(/\*\*/g, '').replace(/__/g, '');

  // DOI extrahieren
  let doi = null;
  const doiCandidates = [
    /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,}(?:\.\d+)?\/[^\s\])>"]+)/i,
    /\[?DOI:\s*(10\.\d{4,}(?:\.\d+)?\/[^\s\]\)>"]+)\]?/i,
    /\b(10\.\d{4,}(?:\.\d+)?\/[^\s\])>"]+)/,
  ];
  for (const re of doiCandidates) {
    const m = line.match(re);
    if (m) {
      doi = m[1].replace(/[.,;:)]+$/, '');
      break;
    }
  }

  // URL als Fallback (NICE/AWMF/Org-Leitlinien)
  let url = null;
  if (!doi) {
    const urlMatch = line.match(/https?:\/\/[^\s\])>"]+/);
    if (urlMatch && !/doi\.org/i.test(urlMatch[0])) {
      url = urlMatch[0].replace(/[.,;:)]+$/, '');
    }
  }

  // Jahr finden: SUCHE alle 4-stelligen Jahres-Klammern, nimm die ERSTE die ein
  // plausibles Publikationsjahr (1980-2030) ist und außerhalb möglicher Akronym-Klammern liegt.
  const yearRe = /\((\d{4})(?:[,;\s][^)]*)?\)/g;
  let yearMatch = null;
  let mY;
  while ((mY = yearRe.exec(line)) !== null) {
    const y = parseInt(mY[1], 10);
    if (y >= 1980 && y <= 2030) {
      yearMatch = { full: mY[0], year: y, index: mY.index };
      break;
    }
  }
  if (!yearMatch) return null;
  const year = yearMatch.year;

  // Authors = alles bis VOR der Jahres-Klammer (inkl. evtl. Akronym-Parens davor),
  // bereinigt um trailing ". " und ". (Org)."
  let authors = line.slice(0, yearMatch.index).trim();
  authors = authors.replace(/[\s.;,]+$/, '').trim();

  // Rest = nach der Jahres-Klammer
  let rest = line.slice(yearMatch.index + yearMatch.full.length).trim();
  rest = rest.replace(/^[.\s]+/, '');

  // DOI-Segment + URL aus rest entfernen
  rest = rest
    .replace(/\[?DOI:\s*[^\]\s]+\]?(?:\([^)]+\))?/gi, '')
    .replace(/\(https?:\/\/[^)]+\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  rest = rest.replace(/[\.\s]+$/, '');

  // Try italic journal: "<title>. *<journal>*[, <vol>(<issue>), <pages>]"
  let title = null, journal = null, n = null;
  const italicRe = /^(.+?)\.\s*\*([^*]+)\*(?:[,.]?\s*(.*))?$/;
  let m = rest.match(italicRe);
  if (m) {
    title = m[1].trim();
    journal = m[2].trim().replace(/[.,;:]+$/, '');
  } else {
    // Format ohne italic: Title. Journal[, vol(issue), pages][, n=…]
    // Heuristik: Split am letzten Punkt-Ende-eines-Satzes vor Komma-Ziffer
    // Versuch: erstes ". " gefolgt von Großbuchstabe als Journal-Start
    const dotMatch = rest.match(/^(.+?)\.\s*([A-Z][^.,]*?(?:[A-Z][^.,]*?)*?)(?:,\s*(.+))?$/);
    if (dotMatch) {
      title = dotMatch[1].trim();
      journal = dotMatch[2].trim().replace(/[.,;:]+$/, '');
    } else {
      // Letzter Versuch: split bei nicht-leerem ".", title = erste Hälfte
      const idx = rest.indexOf('. ');
      if (idx > 10) {
        title = rest.slice(0, idx).trim();
        journal = rest.slice(idx + 2).split(',')[0].trim().replace(/[.,;:]+$/, '');
      } else {
        title = rest;
      }
    }
  }

  // n (Patientenzahl) aus Titel ziehen, falls Format "n=1234" oder "1.234 Patienten"
  const nMatch = (title + ' ' + (journal || '')).match(/\bn\s*=\s*([\d.,]+)/i);
  if (nMatch) n = parseInt(nMatch[1].replace(/[.,]/g, ''), 10);

  if (!title || title.length < 5) return null;

  const typeQuality = detectType(`${title} ${journal || ''}`);

  const id = makeId(authors, year, taken);

  const obj = {
    id,
    ...typeQuality,
    title,
    authors,
    ...(journal ? { journal } : {}),
    year,
    ...(n ? { n } : {}),
    ...(doi ? { doi } : {}),
    ...(url ? { url } : {}),
  };

  return obj;
}

const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
let totalChanged = 0;
const reports = [];

for (const file of files) {
  const path = join(ARTICLES_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const parsed = matter(raw);
  const slug = parsed.data.slug || file.replace(/\.md$/, '');

  const hasStructured = Array.isArray(parsed.data.sources) && parsed.data.sources.length > 0;
  if (hasStructured) {
    reports.push({ file, status: 'skipped (already has structured sources)' });
    continue;
  }

  const section = findQuellenSection(parsed.content);
  if (!section) {
    reports.push({ file, status: 'no Quellen section in body' });
    continue;
  }

  const items = extractListItems(section.listText);
  if (items.length === 0) {
    reports.push({ file, status: 'empty list' });
    continue;
  }

  const taken = new Set();
  const sources = [];
  const failedLines = [];
  for (const item of items) {
    const obj = parseLine(item, taken);
    if (obj) sources.push(obj);
    else failedLines.push(item);
  }

  if (sources.length === 0) {
    reports.push({ file, status: `parse-failed (${failedLines.length} items, alle ungeparst)` });
    continue;
  }

  // Body: Quellen-Section entfernen
  const newBody = parsed.content.slice(0, section.start) + parsed.content.slice(section.end);

  parsed.data.sources = sources;
  const out = matter.stringify(newBody.replace(/[\s\n]+$/, '\n'), parsed.data);

  if (!DRY_RUN) writeFileSync(path, out);

  totalChanged++;
  reports.push({
    file,
    status: 'migrated',
    extracted: sources.length,
    skipped: failedLines.length,
    samples: VERBOSE ? sources.slice(0, 2) : null,
    failed: failedLines,
  });
}

console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}Migriert: ${totalChanged} von ${files.length}\n`);
for (const r of reports) {
  if (r.status === 'migrated') {
    console.log(`  ✓ ${r.file}  → ${r.extracted} sources${r.skipped ? `, ${r.skipped} ungeparst` : ''}`);
    if (r.failed && r.failed.length) {
      for (const f of r.failed.slice(0, 2)) console.log(`      ungeparst: ${f.slice(0, 120)}…`);
    }
    if (r.samples) {
      for (const s of r.samples) console.log(`      sample: ${JSON.stringify(s)}`);
    }
  } else {
    console.log(`  ⊙ ${r.file}  (${r.status})`);
  }
}
