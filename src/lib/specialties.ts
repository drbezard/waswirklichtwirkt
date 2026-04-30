/**
 * Vollständige Liste der medizinischen Fachgebiete für die Übersichtsseite.
 *
 * Wird auf `/fachgebiete` als feste Liste gerendert (auch ohne Artikel),
 * und in `/fachgebiet/[slug]` für Slug→Name-Resolution verwendet.
 *
 * `category:` im Artikel-Frontmatter MUSS exakt einen `name` aus dieser
 * Liste verwenden — siehe Drafting-Master-Prompt.
 */

export interface Specialty {
  name: string;
  slug: string;
  description: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

const ENTRIES: Array<[string, string]> = [
  ['Allgemeinmedizin',          'Hausarztmedizin: erste Anlaufstelle für nahezu alle Beschwerden.'],
  ['Anästhesiologie',           'Narkose, Schmerzmedizin und Intensivversorgung.'],
  ['Augenheilkunde',            'Sehkraft, Netzhaut, Operationen am Auge.'],
  ['Chirurgie',                 'Allgemein-, Visceral-, Unfall-, Plastische und Gefäßchirurgie.'],
  ['Dermatologie',              'Haut, Haare, Nägel und sexuell übertragbare Erkrankungen.'],
  ['Endokrinologie',            'Hormone, Stoffwechsel, Schilddrüse, Diabetes.'],
  ['Gynäkologie',               'Frauenheilkunde, Geburtshilfe, gynäkologische Onkologie.'],
  ['HNO',                       'Hals, Nase, Ohren — von Hörsturz bis Schlafapnoe.'],
  ['Innere Medizin',            'Magen-Darm, Leber, Niere, Lunge — die ganze innere Heilkunde.'],
  ['Kardiologie',               'Herz und Kreislauf: Vorhofflimmern, KHK, Herzinsuffizienz.'],
  ['Kinder- und Jugendmedizin', 'Pädiatrie: vom Säugling bis zum Jugendlichen.'],
  ['Nephrologie',               'Nierenerkrankungen, Dialyse, Bluthochdruck.'],
  ['Neurologie',                'Schlaganfall, Migräne, MS, Parkinson, Demenz.'],
  ['Notfallmedizin',            'Akute, lebensbedrohliche Zustände und Erstversorgung.'],
  ['Onkologie',                 'Krebsdiagnose, Chemotherapie, Immuntherapie, Nachsorge.'],
  ['Orthopädie',                'Knochen, Gelenke, Wirbelsäule, Sportverletzungen.'],
  ['Pneumologie',               'Lungenmedizin: Asthma, COPD, Lungenfibrose.'],
  ['Psychiatrie',               'Depression, Angst, Sucht, Psychotherapie und Medikamente.'],
  ['Radiologie',                'Bildgebung: MRT, CT, Röntgen — was sie sehen können und was nicht.'],
  ['Rheumatologie',             'Autoimmun- und entzündliche Erkrankungen der Gelenke.'],
  ['Urologie',                  'Männergesundheit, Harnwege, Prostata.'],
  ['Zahnmedizin',               'Karies, Parodontitis, Wurzelbehandlung, Zahnersatz.'],
];

export const SPECIALTIES: Specialty[] = ENTRIES.map(([name, description]) => ({
  name,
  slug: toSlug(name),
  description,
}));

export const SPECIALTY_BY_SLUG = new Map(SPECIALTIES.map((s) => [s.slug, s]));
export const SPECIALTY_BY_NAME = new Map(SPECIALTIES.map((s) => [s.name, s]));

export function specialtySlug(name: string): string {
  return SPECIALTY_BY_NAME.get(name)?.slug ?? toSlug(name);
}
