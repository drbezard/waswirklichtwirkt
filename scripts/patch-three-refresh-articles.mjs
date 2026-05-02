/**
 * Einmalpatch: schreibt für die 3 just-refreshten Artikel den vollständigen
 * Wiederherstellungs-Prompt ins Frontmatter und ergänzt die Studien-Headlines
 * um Untertitel-Hinweise.
 *
 * Usage:
 *   node scripts/patch-three-refresh-articles.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'artikel');

// Gemeinsamer Prompt-Skelett
function buildPrompt(title, findings) {
  const findingsList = findings.map((f) => `- ${f}`).join('\n');
  return `Du bist medizinischer Wissenschaftsjournalist für eine unabhängige, werbefreie Plattform. Du verkaufst nichts, hast keinen Interessenkonflikt und gibst ausschließlich wieder, was die Evidenz hergibt. Du bist extrem kritisch — wenn ein Verfahren in Studien nicht besser wirkt als Placebo, schreibst du das ohne Abschwächung.

Schreibe einen evidenzbasierten Patientenartikel auf Deutsch (Sie-Form, 2.500–3.500 Wörter) zum Thema:
**${title}**

Struktur:
(1) KERNAUSSAGE (max. 200 Wörter) — eine glasklare Aussage zur Evidenzlage, Hauptaussage zuerst, einfache Sprache.
(2) WAS PATIENTEN GLAUBEN — UND WAS DIE STUDIEN ZEIGEN (1.500–2.000 Wörter) — häufigste Patientenannahme vs. beste Evidenz; alle relevanten Cochrane-Reviews, Meta-Analysen und Leitlinien zum Thema mit Studienname, Erstautor, Journal, Jahr, Studiendesign, Teilnehmerzahl und Kernergebnis; Fachbegriffe sofort in Klammern erklären; erklären, warum Fehlvorstellungen bestehen (Placebo, Regression zur Mitte, finanzielle Anreize, widersprüchliche Leitlinien).
(3) WANN IST ES DOCH SINNVOLL? (300–400 Wörter) — konkrete Wenn-Dann-Kriterien, Notfall/dringend/elektiv unterscheiden, keine vagen Formulierungen.
(4) WAS SIE IHREN ARZT FRAGEN SOLLTEN (200–300 Wörter) — 5–7 konkrete Fragen mit Erklärung, warum sie wichtig sind.
(5) QUELLENVERZEICHNIS — nur Primärquellen: Cochrane Reviews, Meta-Analysen, RCTs, aktuelle Leitlinien führender Fachgesellschaften. Jede DOI muss unter https://doi.org/ resolvable sein.

Erwartete Schlüsselbefunde (als inhaltliche Vergleichsbasis):
${findingsList}

Quellen-Anforderung: alle aktuellen Cochrane-Reviews + Meta-Analysen + Leitlinien zum Thema; RCTs nur wenn keine Synthese existiert; Beobachtungsstudien nur als Ergänzung. Studien mit hoher Evidenzqualität haben Vorrang. Hierarchie bei Konflikten: Cochrane > aktuelle Leitlinie > Netzwerk-Meta-Analyse > Meta-Analyse > einzelner RCT > Kohortenstudie.

Stilregeln: Deutsch, Sie-Form. Tonfall: direkt, kritisch, respektvoll — nie herablassend, nie alarmistisch, nie verharmlosend. Verboten: Marketingsprache, unbelegte Statistiken, Absolutismen ohne Evidenz, Empfehlungen ohne Studienbeleg, Verharmlosung von Risiken, Verteufelung evidenzbasierter Behandlungen. Gefordert: jede Behauptung mit Quelle, klare Unterscheidung zwischen „belegt"/„unklar"/„widerlegt"; bei widersprüchlicher Datenlage beide Seiten darstellen.

Qualitätskontrolle: jede medizinische Behauptung mit Quelle belegt; alle Fachbegriffe in Klammern erklärt; sowohl kritische Bewertung als auch berechtigte Ausnahmen darstellen. Ein Facharzt würde sagen „fair dargestellt", ein Patient „jetzt verstehe ich meine Optionen".`;
}

const PATCHES = {
  'rueckenschmerzen-mrt-bildgebung-evidenz.md': {
    prompt: buildPrompt(
      'Rückenschmerzen und MRT: Wann Bildgebung schadet',
      [
        'Brinjikji et al. (2015), systematische Literaturübersicht in 33 Studien mit 3.110 beschwerdefreien Personen: Bandscheibenvorwölbungen sind bei 30 % der 20-Jährigen und 84 % der 80-Jährigen Zufallsbefunde — ein Befund im MRT ist in den meisten Fällen nicht die Schmerzursache.',
        'Chou et al. (2009), Lancet-Meta-Analyse von 6 RCTs mit 1.804 Patienten: sofortige Bildgebung verbessert Schmerz, Funktion und Lebensqualität gegenüber abwartendem Vorgehen nicht — weder kurzfristig noch nach 2 Jahren.',
        'Jarvik et al. (2003), JAMA-RCT mit 380 Patienten: Patienten mit frühem MRT erhielten signifikant mehr Wirbelsäulenoperationen, ohne dass sich daraus klinische Vorteile ergaben.',
        'Webster et al. (2013), Spine-Kohortenstudie mit 1.770 arbeitsbedingten Rückenschmerz-Patienten: frühes MRT war mit 174 vs. 21 Tagen Arbeitsunfähigkeit assoziiert, plus dreifachen Behandlungskosten.',
        'Nationale VersorgungsLeitlinie Kreuzschmerz (2017, Bundesärztekammer/KBV/AWMF): bei nicht-spezifischem Kreuzschmerz soll in den ersten 4–6 Wochen keine Bildgebung erfolgen, sofern keine Red Flags (z. B. neurologische Ausfälle, Trauma, Tumor-Anamnese) vorliegen.',
      ],
    ),
    studieNameMap: {
      'Brinjikji et al. (2015)': 'Brinjikji et al. (2015) — MRT-Befunde bei 3.110 Beschwerdefreien',
      'Chou et al. (2009)': 'Chou et al. (2009) — Lancet-Meta-Analyse zu sofortiger vs. abwartender Bildgebung',
      'Jarvik et al. (2003)': 'Jarvik et al. (2003) — JAMA-RCT zu MRT vs. Röntgen bei Rückenschmerz',
      'Webster et al. (2013)': 'Webster et al. (2013) — Kohortenstudie zu iatrogenen Folgen früher MRT',
      'Nationale VersorgungsLeitlinie Kreuzschmerz (2017)': 'Nationale VersorgungsLeitlinie Kreuzschmerz (2017)',
    },
  },

  'prp-eigenbluttherapie-haarausfall.md': {
    prompt: buildPrompt(
      'PRP-Eigenbluttherapie bei Haarausfall: Wirksam oder teures Placebo?',
      [
        'Anitua et al. (2025), Meta-Analyse zu PRP bei Alopezie: aktiviertes plättchenreiches Plasma erhöht die Haardichte gegenüber Placebo signifikant, aber die Effektstärke ist heterogen und hängt stark vom Aufbereitungs-Protokoll ab — es gibt keine standardisierte Methode.',
        'Li et al. (2024), systematische Übersicht: PRP erhöht die Haardichte, zeigt aber keine signifikante Verbesserung des Haardurchmessers; die Wirkung ist temporär und Auffrisch-Sitzungen sind erforderlich.',
        'AWMF-S3-Leitlinie Androgenetische Alopezie (2024): PRP wird als experimentelle Option erwähnt — wegen eingeschränkter Evidenz und fehlender Standardisierung wird KEINE aktive Empfehlung ausgesprochen. Erstlinientherapie bleibt Minoxidil (topisch) bzw. Finasterid (systemisch, beim Mann).',
        'Vergleich mit zugelassenen Therapien: PRP ist eine IGeL-Leistung (200–500 € pro Sitzung, 3–6 Sitzungen jährlich). Minoxidil 5 % topisch kostet ca. 20 €/Monat und hat in mehreren RCTs eine konsistentere und besser belegte Wirksamkeit gezeigt.',
      ],
    ),
    studieNameMap: {
      'Anitua et al. (2025)': 'Anitua et al. (2025) — Meta-Analyse zu PRP bei Alopezie',
      'Li et al. (2024)': 'Li et al. (2024) — Systematische Übersicht zu PRP-Wirkung auf Haardichte',
      'AWMF-S3-Leitlinie Androgenetische Alopezie (2024)': 'AWMF-S3-Leitlinie Androgenetische Alopezie (2024)',
    },
  },

  'augenlaser-operation-was-die-studien-wirklich-zeigen.md': {
    prompt: buildPrompt(
      'Augenlaser-Operation: Was die Studien wirklich zeigen',
      [
        'Shortt et al. (2022), Cochrane-Review zu LASIK vs. Brille/Kontaktlinsen: LASIK ist effektiv zur Korrektur von Kurzsichtigkeit bis ca. -12 Dioptrien; 92–96 % der Patienten erreichen unkorrigierte Sehschärfe von 20/20 oder besser.',
        'Eydelman et al. (2017), PROWL-Studie der FDA mit 574 Patienten: hohe Zufriedenheit, aber 43 % berichteten 6 Monate postoperativ über neu aufgetretene Blendempfindlichkeit, 46 % über Halos um Lichtquellen — gerade beim Nachtsehen relevant.',
        'Stulting et al. (2018), prospektive Studie zu topographie-gesteuerter LASIK: hohe Genauigkeit der Refraktionskorrektur, aber visuelle Nebenphänomene (Glare, Halos, Starbursts) bleiben ein Risiko, das auch moderne Verfahren nicht eliminiert haben.',
        'Sandoval et al. (2019), Übersicht zu LASIK-Komplikationen: trockene Augen sind das häufigste Problem nach LASIK — bis zu 40 % in den ersten 6 Monaten; bei einem Teil der Patienten persistieren die Beschwerden über Jahre und werden zu chronischer Sicca-Symptomatik.',
        'Patientenauswahl: dünne Hornhaut (< 480 µm), Keratokonus-Verdacht, Schwangerschaft, instabile Refraktion, schwere trockene Augen-Symptomatik vor OP sind Kontraindikationen — ein gewissenhafter Operateur lehnt diese Patienten ab, statt sie zu operieren.',
      ],
    ),
    studieNameMap: {
      'Shortt et al. (2022)': 'Shortt et al. (2022) — Cochrane-Review zur LASIK-Wirksamkeit',
      'Eydelman et al. (2017)': 'Eydelman et al. (2017) — PROWL-Studie der FDA zu LASIK-Nebenwirkungen',
      'Sandoval et al. (2019)': 'Sandoval et al. (2019) — Übersicht zu LASIK-Komplikationen',
      'Stulting et al. (2018)': 'Stulting et al. (2018) — Studie zu topographie-gesteuerter LASIK',
    },
  },
};

let totalChanged = 0;
for (const [file, patch] of Object.entries(PATCHES)) {
  const path = join(ARTICLES_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const parsed = matter(raw);

  // Prompt setzen
  parsed.data.prompt = patch.prompt;

  // Studien-Headlines patchen
  let body = parsed.content;
  for (const [oldName, newName] of Object.entries(patch.studieNameMap)) {
    const oldEsc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(<span class="studie-name">)\\s*${oldEsc}\\s*(</span>)`, 'g');
    body = body.replace(re, `$1${newName}$2`);
  }

  const out = matter.stringify(body, parsed.data);
  writeFileSync(path, out);

  const promptLen = patch.prompt.length;
  console.log(`✓ ${file}  (prompt: ${promptLen} Zeichen)`);
  totalChanged++;
}

console.log(`\nFertig: ${totalChanged} Artikel gepatcht.`);
