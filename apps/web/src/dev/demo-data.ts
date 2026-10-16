// Placeholder content for /dev/components only. Real logos and copy come from the seed data.
import type { HexGridCell } from '@/components/hex-grid';
import type { SpotlightItem } from '@/components/spotlight-carousel/spotlight-carousel';

/** A simple seal-style monogram as an SVG data URI, standing in for an organization logo. */
function monogram(text: string, ring: string, fill: string, ink: string): string {
  const size = text.length > 4 ? 26 : 34;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<circle cx="100" cy="100" r="96" fill="${ring}"/>
<circle cx="100" cy="100" r="80" fill="${fill}"/>
<circle cx="100" cy="100" r="72" fill="none" stroke="${ring}" stroke-width="2" stroke-dasharray="3 5"/>
<text x="100" y="100" text-anchor="middle" dominant-baseline="central" font-family="Poppins, sans-serif" font-weight="700" font-size="${size}" fill="${ink}">${text}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const colleges: SpotlightItem[] = [
  {
    id: 'cea',
    name: 'College of Engineering and Architecture',
    motto: 'Designing Structures, Engineering Solutions.',
    logoSrc: monogram('CEA', '#E07B1F', '#1F7A4D', '#FFFFFF'),
    href: '#cea',
  },
  {
    id: 'cat',
    name: 'College of Agriculture and Technology',
    motto: 'Growing Innovation, Harvesting Change.',
    logoSrc: monogram('CAT', '#3C8D2F', '#F3E9D2', '#4A3B1F'),
    href: '#cat',
  },
  {
    id: 'ccis',
    name: 'College of Computing and Information Sciences',
    motto: 'Innovate. Integrate. Inspire.',
    logoSrc: monogram('CCIS', '#E8B800', '#FFD84D', '#3A3A3A'),
    href: '#ccis',
  },
  {
    id: 'con',
    name: 'College of Nursing',
    motto: 'Healing with Skill, Caring with Heart.',
    logoSrc: monogram('CON', '#2E6B4F', '#FFFFFF', '#2E6B4F'),
    href: '#con',
  },
  {
    id: 'ccjs',
    name: 'College of Criminal Justice and Sciences',
    motto: 'Justice through Knowledge, Service with Integrity.',
    logoSrc: monogram('CCJS', '#7A7A7A', '#EDEDED', '#2B2B2B'),
    href: '#ccjs',
  },
  {
    id: 'com',
    name: 'College of Management',
    motto: 'Leading in Business, Hospitality, and Beyond.',
    logoSrc: monogram('COM', '#C9A227', '#1D4FA3', '#FFFFFF'),
    href: '#com',
  },
  {
    id: 'coed',
    name: 'College of Education',
    motto: 'Teaching Minds, Touching Lives.',
    logoSrc: monogram('CoED', '#1D3F91', '#3FB6E6', '#FFFFFF'),
    href: '#coed',
  },
];

export const ceaOrganizations: SpotlightItem[] = [
  {
    id: 'jpice',
    name: 'Junior Philippine Institute of Civil Engineers',
    logoSrc: monogram('JPICE', '#E39A2B', '#26205A', '#E39A2B'),
    href: '#jpice',
  },
  {
    id: 'psme',
    name: 'Philippine Society of Mechanical Engineers',
    logoSrc: monogram('PSME', '#9AA3A0', '#1F3A35', '#D9DEDC'),
    href: '#psme',
  },
  {
    id: 'uapsa',
    name: 'United Architects of the Philippines Student Auxiliary',
    logoSrc: monogram('UAPSA', '#E52421', '#FFFFFF', '#1E7D22'),
    href: '#uapsa',
  },
  {
    id: 'jiiee',
    name: 'Junior Institute of Integrated Electrical Engineers',
    logoSrc: monogram('JIIEE', '#6B2C91', '#1A1A1A', '#F0A23A'),
    href: '#jiiee',
  },
  {
    id: 'icpep',
    name: 'Institute of Computer Engineers of the Philippines Student Edition',
    logoSrc: monogram('ICpEP', '#2C6FB7', '#0E1A2B', '#F08A24'),
    href: '#icpep',
  },
  {
    id: 'iecep',
    name: 'Institute of Electronics Engineers of the Philippines',
    logoSrc: monogram('IECEP', '#1B2E8F', '#FFFFFF', '#1B2E8F'),
    href: '#iecep',
  },
];

/** Home-page honeycomb: colleges with empty filler hexagons around them, as in design/home.png. */
export const homeGrid: HexGridCell[] = [
  null,
  {
    id: 'ccis',
    label: 'College of Computing and Information Sciences',
    logoSrc: colleges[2]!.logoSrc,
    href: '#ccis',
  },
  null,
  {
    id: 'ccjs',
    label: 'College of Criminal Justice and Sciences',
    logoSrc: colleges[4]!.logoSrc,
    href: '#ccjs',
  },
  { id: 'coed', label: 'College of Education', logoSrc: colleges[6]!.logoSrc, href: '#coed' },
  { id: 'con', label: 'College of Nursing', logoSrc: colleges[3]!.logoSrc, href: '#con' },
  {
    id: 'cea',
    label: 'College of Engineering and Architecture',
    logoSrc: colleges[0]!.logoSrc,
    href: '#cea',
  },
  null,
  null,
  { id: 'com', label: 'College of Management', logoSrc: colleges[5]!.logoSrc, href: '#com' },
  {
    id: 'cat',
    label: 'College of Agriculture and Technology',
    logoSrc: colleges[1]!.logoSrc,
    href: '#cat',
  },
  null,
];

/** A first-page preview stand-in for document thumbnails. */
export const pagePreview = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<rect width="400" height="300" fill="#F4F4F2"/>
<rect x="80" y="24" width="240" height="300" fill="#FFFFFF" stroke="#E2E2E2"/>
<rect x="104" y="52" width="120" height="10" rx="2" fill="#9AA7A0"/>
${Array.from({ length: 12 }, (_, i) => `<rect x="104" y="${80 + i * 16}" width="${i % 4 === 3 ? 120 : 192}" height="6" rx="2" fill="#D3D8D5"/>`).join('')}
</svg>`)}`;
