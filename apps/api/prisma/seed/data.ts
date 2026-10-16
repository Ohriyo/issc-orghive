// Seed content. Names, mottos and descriptions are transcribed from the prototype in design/.
// Where the design gives no description (IECEP, ICpEP.SE, PSME), it is left empty on purpose.

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

/** The six student body organizations of CEA. */
export const ceaSbos: SboSeed[] = [
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

/** The three types the sample documents use. The official list is still an open question. */
export const documentTypes = [
  { slug: 'activity-proposal', name: 'Activity proposal' },
  { slug: 'accomplishment-report', name: 'Accomplishment report' },
  { slug: 'resolution', name: 'Resolution' },
];

export type SeedUserKey = 'admin' | 'jpice-officer' | 'jpice-adviser' | 'cea-governor';

/** Fictional development accounts. `.local` addresses can never receive real mail. */
export const users: {
  key: SeedUserKey;
  email: string;
  name: string;
  org: string;
  role: 'officer' | 'adviser' | 'admin';
  isHead: boolean;
  title: string;
  /** Admins have no term end. */
  openEnded?: boolean;
}[] = [
  {
    key: 'admin',
    email: 'admin@orghive.local',
    name: 'ISSC Admin',
    org: 'issc',
    role: 'admin',
    isHead: false,
    title: 'System administrator',
    openEnded: true,
  },
  {
    key: 'jpice-officer',
    email: 'jpice.officer@orghive.local',
    name: 'Juan Dela Cruz',
    org: 'jpice',
    role: 'officer',
    isHead: true,
    title: 'President',
  },
  {
    key: 'jpice-adviser',
    email: 'jpice.adviser@orghive.local',
    name: 'Engr. Ana Santos',
    org: 'jpice',
    role: 'adviser',
    isHead: false,
    title: 'Adviser',
  },
  {
    key: 'cea-governor',
    email: 'cea.governor@orghive.local',
    name: 'Pedro Reyes',
    org: 'csc-cea',
    role: 'officer',
    isHead: true,
    title: 'Governor',
  },
];
