// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

// Slug-Helper für Fachgebiete (deckungsgleich mit src/lib/specialties.ts)
function categorySlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

// Beim Config-Load: aus den Markdown-Frontmatter `date`-Felder zwei Maps bauen,
// damit die sitemap-serialize-Callback je URL ein präzises lastmod setzen kann.
// Drafts werden übersprungen.
const articleLastmod = new Map(); // /artikel/<slug>/ → ISO-Datum
const categoryLastmod = new Map(); // /fachgebiet/<slug>/ → spätester Artikel-Datum dort
let newestArticleDate = null;

try {
  const dir = './src/content/artikel';
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const raw = readFileSync(join(dir, f), 'utf8');
    const { data } = matter(raw);
    if (data.draft || !data.slug || !data.date) continue;

    articleLastmod.set(data.slug, data.date);
    if (!newestArticleDate || data.date > newestArticleDate) {
      newestArticleDate = data.date;
    }
    if (data.category) {
      const slug = categorySlug(data.category);
      const prev = categoryLastmod.get(slug);
      if (!prev || data.date > prev) categoryLastmod.set(slug, data.date);
    }
  }
} catch (err) {
  console.warn('astro.config: konnte Artikel-Daten für Sitemap-lastmod nicht laden:', err.message);
}

// Default-changefreq/priority pro URL-Typ. Der Sitemap-Plugin akzeptiert
// die Werte als Strings ('weekly', 'monthly', …) bzw. Zahlen 0.0–1.0.
function entryDefaults(url) {
  const path = new URL(url).pathname;
  if (path === '/' || path === '') {
    return { changefreq: 'daily', priority: 1.0 };
  }
  if (path.startsWith('/artikel/')) {
    return { changefreq: 'weekly', priority: 0.8 };
  }
  if (path === '/fachgebiete/' || path === '/fachgebiete') {
    return { changefreq: 'monthly', priority: 0.5 };
  }
  if (path.startsWith('/fachgebiet/')) {
    return { changefreq: 'weekly', priority: 0.6 };
  }
  if (path.startsWith('/frage-stellen')) {
    return { changefreq: 'monthly', priority: 0.4 };
  }
  if (path.startsWith('/impressum')) {
    return { changefreq: 'yearly', priority: 0.2 };
  }
  return { changefreq: 'monthly', priority: 0.3 };
}

// lastmod-Auflösung pro URL.
function entryLastmod(url) {
  const path = new URL(url).pathname;

  const articleMatch = path.match(/^\/artikel\/([^/]+)\/?$/);
  if (articleMatch) {
    return articleLastmod.get(articleMatch[1]) || null;
  }

  const categoryMatch = path.match(/^\/fachgebiet\/([^/]+)\/?$/);
  if (categoryMatch) {
    return categoryLastmod.get(categoryMatch[1]) || null;
  }

  // Listen- und Indexseiten zeigen den jüngsten Artikel
  if (path === '/' || path === '/fachgebiete/' || path === '/fachgebiete') {
    return newestArticleDate;
  }

  return null;
}

export default defineConfig({
  site: 'https://waswirktwirklich.com',
  // Hybrid mode: statische Seiten standardmäßig,
  // /arzt/* und /admin/* setzen per `export const prerender = false` auf SSR
  output: 'static',
  adapter: vercel({
    webAnalytics: { enabled: false },
    imageService: false,
  }),
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [sitemap({
    // Admin- und Arzt-Bereich aus Sitemap ausschließen
    filter: (page) =>
      !page.includes('/arzt/') &&
      !page.includes('/admin/') &&
      !page.includes('/auth/') &&
      !page.includes('/api/'),
    serialize(item) {
      const defaults = entryDefaults(item.url);
      const lastmod = entryLastmod(item.url);
      return {
        ...item,
        ...defaults,
        ...(lastmod ? { lastmod } : {}),
      };
    },
  })],
});
