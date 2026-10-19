// Seed content. Names, mottos and descriptions are transcribed from the prototype in design/.
// Where the design gives no description (IECEP, ICpEP.SE, PSME), it is left empty on purpose.

import { PROJECT_TASK_DOCUMENT_TYPES } from '@orghive/shared';

export const issc = {
  slug: 'issc',
  acronym: 'ISSC',
  name: 'Institutional Supreme Student Council',
  description:
    'The ISSC is the highest student governing body in the university. It represents all students, coordinates with collegiate student councils (CSC), and serves as the official link between the student body and the administration to promote student rights, leadership, and campus initiatives.',
};

export interface CollegeSeed {
  code: string;
  slug: string;
  name: string;
  motto: string;
  description?: string;
  /** Description of the college's CSC, when the design has one. */
  cscDescription?: string;
}

export const colleges: CollegeSeed[] = [
  {
    code: 'CAT',
    slug: 'cat',
    name: 'College of Agriculture and Technology',
    motto: 'Growing Innovation, Harvesting Change.',
  },
  {
    code: 'CCIS',
    slug: 'ccis',
    name: 'College of Computing and Information Sciences',
    motto: 'Innovate. Integrate. Inspire.',
  },
  {
    code: 'CCJS',
    slug: 'ccjs',
    name: 'College of Criminal Justice and Sciences',
    motto: 'Justice through Knowledge, Service with Integrity.',
  },
  {
    code: 'CEA',
    slug: 'cea',
    name: 'College of Engineering and Architecture',
    motto: 'Designing Structures, Engineering Solutions.',
    description:
      'The College of Engineering and Architecture is home to dynamic student organizations (JPICE, IECEP, ICpEP.SE, PSME, UAPSA, and JIIEE) that represent various engineering disciplines. These groups promote academic excellence, technical skills, leadership, and professional growth among future engineers and architects.',
    cscDescription:
      'The CSC-CEA serves as the official student governing body, uniting all CEA-tizens through leadership, representation, and support for academic and extracurricular initiatives.',
  },
  {
    code: 'CoED',
    slug: 'coed',
    name: 'College of Education',
    motto: 'Teaching Minds, Touching Lives.',
  },
  {
    code: 'COM',
    slug: 'com',
    name: 'College of Management',
    motto: 'Leading in Business, Hospitality, and Beyond.',
  },
  {
    code: 'CON',
    slug: 'con',
    name: 'College of Nursing',
    motto: 'Healing with Skill, Caring with Heart.',
  },
];

export function cscSlug(collegeSlug: string): string {
  return `csc-${collegeSlug}`;
}

export interface SboSeed {
  slug: string;
  acronym: string;
  name: string;
  description?: string;
}

/**
 * Each college's student body organizations, in carousel order. Names come from the list the
 * project owner provided on 2026-10-18 and from the organizations' own logos; none has a
 * description yet, and none should be invented. Not every college's SBOs are listed yet.
 * Logos are assets/logos/<slug>.webp.
 */
const ccisSbos: SboSeed[] = [
  { slug: 'tag', acronym: 'TAG', name: 'The Animation Guild' },
  { slug: 'asit', acronym: 'ASIT', name: 'Allied Students of Information Technology' },
  { slug: 'iso', acronym: 'ISO', name: 'Information Systems Organization' },
  { slug: 'the-nexus', acronym: 'The Nexus', name: 'The Nexus' },
  { slug: 'cs3', acronym: 'CS³', name: "Computer Science Students' Society" },
];

const ccjsSbos: SboSeed[] = [
  { slug: 'jcap', acronym: 'JCAP', name: 'Junior Criminology Association of the Philippines' },
  { slug: 'save-me', acronym: 'SAVE ME', name: 'SAVE ME Movement - NwSSU Chapter' },
];

const catSbos: SboSeed[] = [
  { slug: 'site', acronym: 'SITE', name: 'Society of Industrial Technology Enthusiasts' },
  {
    slug: 'paft-nsc',
    acronym: 'PAFT-NSC',
    name: 'Philippine Association of Food Technologists-NwSSU Student Chapter',
  },
];

const comSbos: SboSeed[] = [
  { slug: 'jaspen', acronym: 'JASPEN', name: 'Junior Asia Pacific Entrepreneurs' },
  {
    slug: 'pasoa',
    acronym: 'PASOA',
    name: 'Philippine Association of Students in Office Administration',
  },
  { slug: 'jma', acronym: 'JMA', name: 'Junior Marketing Association' },
  { slug: 'tco', acronym: 'TCO', name: 'Tourism Clique Organization' },
];

const coedSbos: SboSeed[] = [
  { slug: 'geg', acronym: 'GEG', name: 'General Education Guild' },
  { slug: 'meg', acronym: 'MEG', name: 'Mathematics Educators Guild' },
  { slug: 'socius', acronym: 'SOCIUS', name: 'SOCIUS (The Society)' },
  { slug: 'tveg', acronym: 'TVEG', name: "Technical Vocational Educators' Guild" },
  // The list says "English Educators Guild (EEA)"; the logo and its acronym say Association.
  { slug: 'eea', acronym: 'EEA', name: 'English Educators Association' },
];

const conSbos: SboSeed[] = [
  { slug: 'concare', acronym: 'CONCare', name: 'CONCare' },
  { slug: 'consonance', acronym: 'CONsonance', name: 'CONsonance' },
];

/** The six student body organizations of CEA. */
const ceaSbos: SboSeed[] = [
  {
    slug: 'jpice',
    acronym: 'JPICE',
    name: 'Junior Philippine Institute of Civil Engineers',
    description:
      'The JPICE is a dynamic organization committed to shaping competent and socially responsible civil engineering students through academic enrichment, technical training, and community engagement.',
  },
  {
    slug: 'iecep',
    acronym: 'IECEP',
    name: 'Institute of Electronics Engineers of the Philippines',
  },
  {
    slug: 'icpep-se',
    acronym: 'ICpEP.SE',
    name: 'Institute of Computer Engineers of the Philippines - Student Edition',
  },
  {
    slug: 'psme',
    acronym: 'PSME',
    name: 'Philippine Society of Mechanical Engineers',
  },
  {
    slug: 'uapsa',
    acronym: 'UAPSA',
    name: 'United Architects of the Philippines Student Auxiliary',
    description:
      'The UAPSA nurtures aspiring architects by fostering creativity, professional discipline, and a deep sense of social responsibility through exposure to design challenges and architectural discourse.',
  },
  {
    slug: 'jiiee',
    acronym: 'JIIEE',
    name: 'Junior Institute of Integrated Electrical Engineers',
    description:
      'The JIIEE builds a strong foundation for electrical engineering students by offering opportunities for academic growth, technical competence, and ethical practice.',
  },
];

/** Student body organizations by college code. */
export const sbosByCollege: Record<string, SboSeed[]> = {
  CAT: catSbos,
  CCIS: ccisSbos,
  CCJS: ccjsSbos,
  CEA: ceaSbos,
  CoED: coedSbos,
  COM: comSbos,
  CON: conSbos,
};

/**
 * The types the sample documents use, plus the ones project task files are archived as.
 * The official list is still an open question.
 */
export const documentTypes = [
  { slug: 'activity-proposal', name: 'Activity proposal' },
  { slug: 'accomplishment-report', name: 'Accomplishment report' },
  { slug: 'resolution', name: 'Resolution' },
  ...Object.values(PROJECT_TASK_DOCUMENT_TYPES),
];

/**
 * One shared development account per organization (docs/DOMAIN_RULES.md, "Accounts"), at
 * `<slug>@orghive.local`: `.local` addresses can never receive real mail. The officers in
 * charge below are fictional; organizations not listed get a placeholder.
 */
export function accountEmail(slug: string): string {
  return `${slug}@orghive.local`;
}

export const officersInCharge: Record<string, { name: string; position: string }> = {
  issc: { name: 'Maria Lopez', position: 'ISSC President' },
  'csc-cea': { name: 'Pedro Reyes', position: 'Governor' },
  jpice: { name: 'Juan Dela Cruz', position: 'President' },
};
