/**
 * POST /api/fragen/submit
 *
 * Patient sendet eine Frage. Wir prüfen Anti-Spam, machen einen sofortigen
 * KI-Check (Haiku 4.5) auf Sinnhaftigkeit, medizinische Relevanz und
 * Duplikat-Status, und schreiben das Ergebnis in patient_questions.
 *
 * Rate-Limit: 5 pro 7 Tage je E-Mail und je IP.
 *
 * Antwort an den Client:
 *  - 200 mit { status: 'duplicate', duplicate_slug, duplicate_title } → existiert schon
 *  - 200 mit { status: 'submitted' }                                  → wird in der Pipeline geprüft
 *  - 200 mit { status: 'rejected', reason }                           → KI hält sie für nicht sinnvoll
 *  - 429 mit { error: 'rate_limit', reason: 'email_limit'|'ip_limit' }
 *  - 400 mit { error: 'invalid_input', detail }
 */

import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdminClient } from '../../../lib/supabase/admin';

export const prerender = false;

const MAX_QUESTION_LEN = 1000;
const MIN_QUESTION_LEN = 10;
const RATE_LIMIT_PER_WEEK = 5;

function clientIp(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip');
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

interface ClassifyResult {
  sensible: boolean;
  medical_relevant: boolean;
  duplicate_slug: string | null;
  suggested_topic_title: string;
  reasoning: string;
}

async function classify(
  question: string,
  articles: Array<{ slug: string; title: string; excerpt: string }>,
  apiKey: string,
): Promise<ClassifyResult> {
  const client = new Anthropic({ apiKey });
  const articleList = articles
    .map((a, i) => `${i + 1}. [${a.slug}] ${a.title}\n   ${a.excerpt}`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: [
      {
        type: 'text',
        text:
          'Du klassifizierst Patienten-Fragen für eine evidenzbasierte Medizin-Website. ' +
          'Antworte AUSSCHLIESSLICH mit gültigem JSON, ohne Markdown-Codeblock und ohne Einleitung.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content:
          `Bestehende Artikel auf der Website:\n${articleList}\n\n` +
          `Patienten-Frage:\n"${question}"\n\n` +
          `Bewerte die Frage und antworte als JSON mit genau diesen Feldern:\n` +
          `{\n` +
          `  "sensible": boolean,            // Ist die Frage verständlich, kein Spam, keine Beleidigung?\n` +
          `  "medical_relevant": boolean,    // Geht es um ein medizinisches Thema, das in eine Evidenz-Site passt?\n` +
          `  "duplicate_slug": string|null,  // Wenn ein bestehender Artikel die Frage bereits beantwortet: dessen slug. Sonst null.\n` +
          `  "suggested_topic_title": string,// Knapper Themen-Titel (5-10 Wörter), falls die Frage neu ist.\n` +
          `  "reasoning": string             // Ein kurzer deutscher Satz: warum diese Bewertung?\n` +
          `}\n\n` +
          `Sei vorsichtig mit Duplikaten: nur echte Themen-Überschneidung zählt, nicht nur ähnliche Stichwörter.`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  let cleaned = text;
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\s*/, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(cleaned);
  return {
    sensible: !!parsed.sensible,
    medical_relevant: !!parsed.medical_relevant,
    duplicate_slug: parsed.duplicate_slug || null,
    suggested_topic_title: String(parsed.suggested_topic_title || '').trim(),
    reasoning: String(parsed.reasoning || '').trim(),
  };
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'server_misconfigured' }), { status: 500 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
  }

  // Honeypot: das Feld 'website' ist im UI versteckt — wenn Bots es ausfüllen, leise ablehnen
  if (body.website && String(body.website).trim().length > 0) {
    return new Response(JSON.stringify({ status: 'submitted' }), { status: 200 });
  }

  const question = String(body.question || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const firstName = body.first_name ? String(body.first_name).trim().slice(0, 80) : null;
  const newsletterConsent = !!body.newsletter_consent;

  if (question.length < MIN_QUESTION_LEN || question.length > MAX_QUESTION_LEN) {
    return new Response(JSON.stringify({ error: 'invalid_input', detail: 'question_length' }), { status: 400 });
  }
  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ error: 'invalid_input', detail: 'email' }), { status: 400 });
  }

  const ip = clientIp(request);
  const userAgent = request.headers.get('user-agent') || null;
  const admin = getSupabaseAdminClient();

  // Rate-Limit
  const { data: rateLimitData, error: rateLimitErr } = await admin.rpc('check_patient_question_rate_limit', {
    p_email: email,
    p_ip: ip,
    p_max: RATE_LIMIT_PER_WEEK,
  });
  if (rateLimitErr) {
    console.error('rate-limit-check failed', rateLimitErr);
    return new Response(JSON.stringify({ error: 'rate_limit_check_failed' }), { status: 500 });
  }
  if (rateLimitData && (rateLimitData as any).allowed === false) {
    return new Response(
      JSON.stringify({ error: 'rate_limit', reason: (rateLimitData as any).reason }),
      { status: 429 },
    );
  }

  // Artikel-Liste für Duplikat-Check holen
  const { data: articles } = await admin
    .from('articles')
    .select('slug, title, excerpt')
    .order('published_at', { ascending: false })
    .limit(80);

  let classification: ClassifyResult;
  try {
    classification = await classify(question, articles || [], apiKey);
  } catch (err: any) {
    console.error('classify-failed', err?.message || err);
    classification = {
      sensible: true,
      medical_relevant: true,
      duplicate_slug: null,
      suggested_topic_title: question.slice(0, 80),
      reasoning: 'KI-Check fehlgeschlagen — Frage zur manuellen Prüfung gespeichert.',
    };
  }

  let status: 'submitted' | 'rejected' | 'duplicate' = 'submitted';
  let rejectionReason: string | null = null;
  let duplicateSlug: string | null = null;
  let duplicateTitle: string | null = null;

  if (classification.duplicate_slug) {
    const existing = (articles || []).find((a) => a.slug === classification.duplicate_slug);
    if (existing) {
      status = 'duplicate';
      duplicateSlug = existing.slug;
      duplicateTitle = existing.title;
    }
  }

  if (status === 'submitted' && (!classification.sensible || !classification.medical_relevant)) {
    status = 'rejected';
    rejectionReason = !classification.sensible
      ? 'Frage erscheint nicht sinnvoll formuliert.'
      : 'Frage ist nicht medizinisch relevant.';
  }

  const { error: insertErr } = await admin.from('patient_questions').insert({
    question,
    email,
    first_name: firstName,
    ip_address: ip,
    user_agent: userAgent,
    status,
    ai_classification: classification as any,
    ai_reasoning: classification.reasoning,
    duplicate_of_slug: duplicateSlug,
    rejection_reason: rejectionReason,
    newsletter_consent: newsletterConsent,
  });

  if (insertErr) {
    console.error('insert-failed', insertErr);
    return new Response(JSON.stringify({ error: 'insert_failed' }), { status: 500 });
  }

  if (status === 'duplicate') {
    return new Response(
      JSON.stringify({ status, duplicate_slug: duplicateSlug, duplicate_title: duplicateTitle }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (status === 'rejected') {
    return new Response(
      JSON.stringify({ status, reason: rejectionReason }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(JSON.stringify({ status }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
