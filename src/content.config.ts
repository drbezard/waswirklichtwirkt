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

const artikel = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/artikel' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    date: z.string(),
    category: z.string(),
    excerpt: z.string(),
    image: z.string().optional(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).optional(),
    prompt: z.string().optional(),
    sources: z.array(z.union([z.string(), sourceObjectSchema])).optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

export const collections = { artikel };
