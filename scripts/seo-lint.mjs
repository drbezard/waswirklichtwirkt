/**
 * Build-time SEO-Lint für Bestandsartikel.
 *
 * Läuft als prebuild-Hook (siehe package.json). Gibt Warnungen aus, BLOCKT NICHT
 * den Build. Damit alte Artikel ohne ergänzte SEO-Felder weiter durchgehen.
 *
 * Geprüft wird je Artikel im `src/content/artikel/`-Verzeichnis:
 *   - title    > 60 Zeichen        → WARN (zu lang für Suchergebnis-Anzeige)
 *   - seoTitle > 60 Zeichen        → WARN (frisst Keywords)
 *   - excerpt  außerhalb 80–120    → WARN (Card-Snippet, nicht Meta-Description)
 *   - seoDescription außerhalb 140–160 → WARN (Suchergebnis-Snippet)
 *
 * Usage:
 *   node scripts/seo-lint.mjs           # warnt, exit 0
 *   node scripts/seo-lint.mjs --strict  # warnt + exit 1 bei Verstoß (für CI)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'artikel');
const STRICT = process.argv.includes('--strict');

const LIMITS = {
  title: { max: 60 },
  seoTitle: { max: 60 },
  excerpt: { min: 80, max: 120 },
  seoDescription: { min: 140, max: 160 },
};

const C = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

const findings = [];

function pushFinding(file, level, msg) {
  findings.push({ file, level, msg });
}

function checkField(file, fieldName, value, limit) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') return;
  const len = [...value].length; // codepoint-aware length
  if (limit.max !== undefined && len > limit.max) {
    pushFinding(file, 'warn', `${fieldName} ${len} Zeichen (max ${limit.max})`);
  }
  if (limit.min !== undefined && len < limit.min) {
    pushFinding(file, 'warn', `${fieldName} ${len} Zeichen (min ${limit.min})`);
  }
}

const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md')).sort();

for (const file of files) {
  const path = join(ARTICLES_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const { data } = matter(raw);

  if (data.draft) continue; // drafts sind beim Lint-Lauf irrelevant

  for (const [field, limit] of Object.entries(LIMITS)) {
    checkField(file, field, data[field], limit);
  }
}

const warnCount = findings.filter((f) => f.level === 'warn').length;

if (findings.length === 0) {
  console.log(`${C.cyan}seo-lint:${C.reset} ${C.dim}${files.length} Artikel geprüft, keine Auffälligkeiten.${C.reset}`);
  process.exit(0);
}

console.log(`${C.cyan}seo-lint:${C.reset} ${files.length} Artikel geprüft, ${warnCount} Warnung${warnCount === 1 ? '' : 'en'}:\n`);

const grouped = new Map();
for (const f of findings) {
  if (!grouped.has(f.file)) grouped.set(f.file, []);
  grouped.get(f.file).push(f);
}
for (const [file, items] of grouped) {
  console.log(`  ${C.dim}${file}${C.reset}`);
  for (const it of items) {
    const tag = it.level === 'warn' ? `${C.yellow}WARN${C.reset}` : `${C.red}ERR${C.reset} `;
    console.log(`    ${tag}  ${it.msg}`);
  }
}
console.log('');

if (STRICT && warnCount > 0) {
  console.log(`${C.red}seo-lint:${C.reset} --strict gesetzt, exit 1.`);
  process.exit(1);
}

process.exit(0);
