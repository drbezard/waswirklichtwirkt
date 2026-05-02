import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Quellen können entweder als einfacher String (Legacy) oder als strukturiertes
// Objekt (Manus-Format) angegeben sein. Strukturierte Quellen erlauben
// DOI-Verifikation, Qualitäts-Badges und Key-Findings direkt in der Anzeige.
const sourceObjectSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  quality: z.string().optional(),
  title: z.string().optional(),
  authors: z.string().optional(),
  journal: z.string().optional(),
  year: z.number().optional(),
  n: z.number().optional(),
  doi: z.string().optional(),
  doi_verified: z.boolean().optional(),
  doi_checked_at: z.string().optional(),
  url: z.string().optional(),
  key_finding_de: z.string().optional(),
});

export type SourceObject = z.infer<typeof sourceObjectSchema>;

// Strukturierte FAQ-Einträge — Vorzug vor der Body-Regex-Extraktion in
// `[slug].astro`, sobald das Feld gesetzt ist.
const faqItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

export type FaqItem = z.infer<typeof faqItemSchema>;

// Reviewer-Architektur: Vorbereitung für JSON-LD `reviewedBy` (Phase 2).
// Wird nur ausgegeben, wenn das Feld gesetzt ist.
const reviewerSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  specialty: z.string().optional(),
  reviewedAt: z.string().optional(),
});

export type Reviewer = z.infer<typeof reviewerSchema>;

const artikel = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/artikel' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    date: z.string(),
    category: z.string(),
    // Card-Vorschau auf Startseite/Fachgebiet (80–120 Zeichen).
    // Andere Rolle als seoDescription (Suchergebnis-Snippet).
    excerpt: z.string(),
    image: z.string().optional(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).optional(),
    prompt: z.string().optional(),
    sources: z.array(z.union([z.string(), sourceObjectSchema])).optional(),

    // SEO-Felder
    // Wenn gesetzt → ersetzt `title` im <title>-Tag und Open-Graph.
    seoTitle: z.string().optional(),
    // 140–160 Zeichen, dient als <meta name="description">.
    seoDescription: z.string().optional(),
    // Hauptkeyword des Artikels — fließt in Related-Articles-Boost (PR 5)
    // und in den `about`-Block des Article-Schemas (PR 3) ein.
    mainKeyword: z.string().optional(),
    // Nebenkeywords für semantische Verlinkung.
    secondaryKeywords: z.array(z.string()).optional(),
    // Strukturierte FAQ — Vorzug vor Body-Regex (siehe `[slug].astro`).
    faqItems: z.array(faqItemSchema).optional(),
    // Reviewer-Architektur, jetzt nur als optionales Feld vorbereitet.
    reviewer: reviewerSchema.optional(),
  }),
});

export const collections = { artikel };
