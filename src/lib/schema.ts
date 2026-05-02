/**
 * Schema.org-Helper für JSON-LD-Generierung.
 *
 * Trennt klar zwischen:
 *   - PUBLISHER (rechtlich verantwortlich, Bezard Media GmbH, im Impressum sichtbar)
 *   - BRAND     (öffentliche Identität, "Was Wirkt Wirklich")
 *
 * Stable @id-URLs erlauben Cross-Referencing zwischen Schemas auf
 * derselben Seite und über Seiten hinweg.
 */

export const SITE_URL = 'https://waswirktwirklich.com';

export const PUBLISHER_ID = `${SITE_URL}/#publisher`;
export const BRAND_ID = `${SITE_URL}/#brand`;

/**
 * Bezard Media GmbH — rechtlich verantwortliche Stelle.
 * Vollständige Adresse + Kontakt fließen ins Impressum-Schema.
 */
export const PUBLISHER_ORG = {
  '@type': 'Organization',
  '@id': PUBLISHER_ID,
  name: 'Bezard Media GmbH',
  url: 'https://www.bezardmedia.com',
  email: 'office@bezardmedia.com',
  telephone: '+43 660 3737936',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Döblinger Hauptstraße 17',
    addressLocality: 'Wien',
    postalCode: '1190',
    addressCountry: 'AT',
  },
} as const;

/**
 * Was Wirkt Wirklich — Brand / Publikations-Marke.
 * Logo wird hier referenziert (Schema.org bevorzugt PNG).
 */
export const BRAND_ORG = {
  '@type': 'Organization',
  '@id': BRAND_ID,
  name: 'Was Wirkt Wirklich',
  url: SITE_URL,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE_URL}/logo.png`,
    contentUrl: `${SITE_URL}/logo.png`,
    width: 600,
    height: 60,
  },
  // Brand wird von Bezard Media GmbH herausgegeben
  parentOrganization: { '@id': PUBLISHER_ID },
} as const;

// ---------------------------------------------------------------------------
// Builder-Funktionen pro Seitentyp
// ---------------------------------------------------------------------------

interface ArticleData {
  title: string;
  slug: string;
  date: string;
  category: string;
  excerpt: string;
  image?: string;
  tags?: string[];
  mainKeyword?: string;
  secondaryKeywords?: string[];
  reviewer?: {
    name: string;
    title?: string;
    specialty?: string;
    reviewedAt?: string;
  };
}

/**
 * MedicalWebPage — bestehendes Haupt-Schema, jetzt mit Bezard Media als publisher.
 */
export function buildMedicalWebPage(article: ArticleData, canonicalUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    '@id': `${canonicalUrl}#webpage`,
    headline: article.title,
    description: article.excerpt,
    datePublished: article.date,
    dateModified: article.date,
    inLanguage: 'de-DE',
    url: canonicalUrl,
    ...(article.image && { image: article.image }),
    author: { '@id': BRAND_ID },
    publisher: { '@id': PUBLISHER_ID },
    about: {
      '@type': 'MedicalCondition',
      name: article.category,
    },
    ...(article.reviewer && { reviewedBy: buildReviewerPerson(article.reviewer) }),
  };
}

/**
 * Article — News/Editorial-Schema, ergänzt MedicalWebPage.
 * Bringt headline/datePublished/dateModified/keywords richer ins Frontend.
 */
export function buildArticle(article: ArticleData, canonicalUrl: string) {
  const keywords = [
    article.mainKeyword,
    ...(article.secondaryKeywords ?? []),
    ...(article.tags ?? []),
  ].filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${canonicalUrl}#article`,
    headline: article.title,
    description: article.excerpt,
    datePublished: article.date,
    dateModified: article.date,
    inLanguage: 'de-DE',
    articleSection: article.category,
    ...(keywords.length > 0 && { keywords: keywords.join(', ') }),
    ...(article.image && {
      image: {
        '@type': 'ImageObject',
        url: article.image,
      },
    }),
    mainEntityOfPage: { '@id': `${canonicalUrl}#webpage` },
    author: { '@id': BRAND_ID },
    publisher: { '@id': PUBLISHER_ID },
    ...(article.reviewer && { reviewedBy: buildReviewerPerson(article.reviewer) }),
  };
}

/**
 * BreadcrumbList — bestehend, leicht aufgeräumt.
 */
export function buildBreadcrumb(article: ArticleData, canonicalUrl: string, categorySlug: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Startseite', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: article.category, item: `${SITE_URL}/fachgebiet/${categorySlug}/` },
      { '@type': 'ListItem', position: 3, name: article.title, item: canonicalUrl },
    ],
  };
}

/**
 * FAQPage — Vorzug für strukturierte faqItems aus dem Frontmatter,
 * sonst Fallback auf Body-extrahierte Q&A. Mindestens 2 Pairs.
 */
export function buildFaqPage(faqs: Array<{ question: string; answer: string }>) {
  if (faqs.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

/**
 * Person-Schema für reviewedBy. Wird nur referenziert, wenn reviewer-Feld
 * im Frontmatter gesetzt ist.
 */
function buildReviewerPerson(reviewer: NonNullable<ArticleData['reviewer']>) {
  return {
    '@type': 'Person',
    name: reviewer.name,
    ...(reviewer.title && { honorificPrefix: reviewer.title }),
    ...(reviewer.specialty && { jobTitle: reviewer.specialty }),
    ...(reviewer.reviewedAt && { reviewedAt: reviewer.reviewedAt }),
  };
}

/**
 * Standalone Organization-Schemas — beide Entitäten als eigenständige
 * JSON-LD-Blöcke, damit Google die @id-Referenzen aus Article/MedicalWebPage
 * auflösen kann.
 */
export const PUBLISHER_ORG_SCHEMA = {
  '@context': 'https://schema.org',
  ...PUBLISHER_ORG,
};

export const BRAND_ORG_SCHEMA = {
  '@context': 'https://schema.org',
  ...BRAND_ORG,
};
