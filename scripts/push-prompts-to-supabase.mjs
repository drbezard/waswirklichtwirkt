/**
 * Schreibt die lokalen prompts/<key>.md (ohne Frontmatter) in die Supabase
 * `prompts`-Tabelle. Wird einmalig nach Prompt-Updates ausgeführt.
 *
 * Idempotent: setzt nur, wenn der bestehende Body unterschiedlich ist.
 *
 * Usage:
 *   SUPABASE_PROJECT_REF=… SUPABASE_ACCESS_TOKEN=… node scripts/push-prompts-to-supabase.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error('SUPABASE_PROJECT_REF und SUPABASE_ACCESS_TOKEN müssen gesetzt sein.');
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Supabase API: ${res.status} ${await res.text()}`);
  return res.json();
}

const files = readdirSync(PROMPTS_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');

for (const file of files) {
  const path = join(PROMPTS_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const parsed = matter(raw);

  const key = parsed.data.key;
  if (!key) {
    console.warn(`SKIP ${file}: kein key im Frontmatter`);
    continue;
  }

  const body = parsed.content.replace(/^[\s\n]+/, '').replace(/[\s\n]+$/, '\n');

  const escaped = body.replace(/'/g, "''");
  const result = await query(
    `UPDATE public.prompts SET body = '${escaped}', version = version + 1, updated_at = now() WHERE key = '${key.replace(/'/g, "''")}' AND body <> '${escaped}' RETURNING key, version`,
  );

  if (Array.isArray(result) && result.length > 0) {
    console.log(`✓ ${key} → v${result[0].version}`);
  } else {
    console.log(`⊙ ${key} (keine Änderung)`);
  }
}
