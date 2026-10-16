import { describe, expect, it } from 'vitest';
import type { CollegeDetail } from '@orghive/shared';
import { toCollegePage, toSboHoneycomb } from './use-college-page';

function sbo(acronym: string) {
  return {
    type: 'SBO' as const,
    slug: acronym.toLowerCase().replace('.', '-'),
    acronym,
    name: `${acronym} full name`,
    logoUrl: null,
  };
}

const CEA: CollegeDetail = {
  code: 'CEA',
  slug: 'cea',
  name: 'College of Engineering and Architecture',
  motto: 'Designing Structures, Engineering Solutions.',
  description: 'The College of Engineering and Architecture is home to JPICE and PSME.',
  csc: {
    type: 'CSC',
    slug: 'csc-cea',
    acronym: 'CSC-CEA',
    name: 'Collegiate Student Council of the College of Engineering and Architecture',
    description: 'The CSC-CEA unites all CEA-tizens.',
    logoUrl: 'https://cdn.test/csc-cea.png',
  },
  sbos: ['JPICE', 'IECEP', 'ICpEP.SE', 'PSME', 'UAPSA', 'JIIEE'].map(sbo),
};

describe('toSboHoneycomb', () => {
  it('places six SBOs as in the prototype, with fillers on the top row and right column', () => {
    const cells = toSboHoneycomb(CEA.sbos);
    expect(cells.map((cell) => cell?.id ?? '-')).toEqual([
      '-',
      'jpice',
      '-',
      '-',
      'iecep',
      'icpep-se',
      'psme',
      '-',
      'uapsa',
      '-',
      'jiiee',
      '-',
    ]);
    expect(cells[1]).toMatchObject({ href: '/orgs/jpice', shortName: 'JPICE' });
  });

  it('uses the spare slot past six SBOs and appends the rest, dropping none', () => {
    const many = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8'].map(sbo);
    const ids = toSboHoneycomb(many)
      .filter(Boolean)
      .map((cell) => cell!.id);
    expect(ids).toHaveLength(8);
    expect(toSboHoneycomb(many)[9]?.id).toBe('f6');
  });
});

describe('toCollegePage', () => {
  it('sets the college name and SBO acronyms in bold inside the description', () => {
    const page = toCollegePage(CEA);
    expect(page.intro?.filter((s) => s.strong).map((s) => s.text)).toEqual([
      'College of Engineering and Architecture',
      'JPICE',
      'PSME',
    ]);
  });

  it('lists the SBOs when the college has no description', () => {
    const page = toCollegePage({ ...CEA, description: null, sbos: ['JPICE', 'PSME'].map(sbo) });
    expect(page.intro?.map((s) => s.text).join('')).toBe(
      'The College of Engineering and Architecture is home to 2 student body organizations: JPICE and PSME.',
    );
  });

  it('shapes the CSC card with its Paperworks link and bold acronym', () => {
    const { csc, sbosHref } = toCollegePage(CEA);
    expect(csc).toMatchObject({
      acronym: 'CSC-CEA',
      logoSrc: 'https://cdn.test/csc-cea.png',
      paperworksHref: '/orgs/csc-cea/paperworks',
    });
    expect(csc?.description?.filter((s) => s.strong).map((s) => s.text)).toEqual(['CSC-CEA']);
    expect(sbosHref).toBe('/colleges/cea/organizations');
  });

  it('has no intro and no honeycomb for an empty college', () => {
    const page = toCollegePage({ ...CEA, description: null, csc: null, sbos: [] });
    expect(page.intro).toBeNull();
    expect(page.honeycomb).toEqual([]);
    expect(page.csc).toBeNull();
  });
});
