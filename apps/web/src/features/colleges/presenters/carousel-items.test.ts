import { describe, expect, it } from 'vitest';
import type { CollegeDetail, CollegeListResponse } from '@orghive/shared';
import { toCollegeItems } from './use-college-carousel';
import { toSboItems } from './use-sbo-carousel';

describe('toCollegeItems', () => {
  it('makes one slide per college with its motto, CSC logo and college link', () => {
    const body: CollegeListResponse = {
      colleges: [
        {
          code: 'CEA',
          slug: 'cea',
          name: 'College of Engineering and Architecture',
          motto: 'Designing Structures, Engineering Solutions.',
          csc: {
            type: 'CSC',
            slug: 'csc-cea',
            acronym: 'CSC-CEA',
            name: 'CSC of CEA',
            logoUrl: 'https://cdn.test/logos/csc-cea.webp',
          },
        },
        { code: 'CON', slug: 'con', name: 'College of Nursing', motto: null, csc: null },
      ],
    };

    expect(toCollegeItems(body)).toEqual([
      {
        id: 'cea',
        name: 'College of Engineering and Architecture',
        motto: 'Designing Structures, Engineering Solutions.',
        logoSrc: 'https://cdn.test/logos/csc-cea.webp',
        shortName: 'CEA',
        href: '/colleges/cea',
      },
      {
        id: 'con',
        name: 'College of Nursing',
        motto: undefined,
        logoSrc: undefined,
        shortName: 'CON',
        href: '/colleges/con',
      },
    ]);
  });
});

describe('toSboItems', () => {
  it('makes one slide per SBO, linking to the organization page', () => {
    const college: CollegeDetail = {
      code: 'CEA',
      slug: 'cea',
      name: 'College of Engineering and Architecture',
      motto: null,
      description: null,
      csc: null,
      sbos: [
        {
          type: 'SBO',
          slug: 'jpice',
          acronym: 'JPICE',
          name: 'Junior Philippine Institute of Civil Engineers',
          logoUrl: null,
        },
      ],
    };

    expect(toSboItems(college)).toEqual([
      {
        id: 'jpice',
        name: 'Junior Philippine Institute of Civil Engineers',
        logoSrc: undefined,
        shortName: 'JPICE',
        href: '/orgs/jpice',
      },
    ]);
  });
});
