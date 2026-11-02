import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readBarcodes } from 'zxing-wasm/reader';
import type { CheckedTaskType } from '@orghive/shared';
import {
  buildTaskTemplate,
  longDate,
  officeName,
  orientationOf,
  renderQrImage,
  type TemplateContext,
} from '#src/lib/task-template';

const context = (type: CheckedTaskType, patch: Partial<TemplateContext> = {}): TemplateContext => ({
  type,
  organization: { name: 'The Animation Guild', acronym: 'TAG', type: 'SBO' },
  college: 'College of Computing and Information Sciences',
  project: {
    name: 'Making Moves: An Intro to 3D Animation Workshop',
    targetDate: '2026-11-07',
    location: 'CCIS Digital Animation Laboratory',
    beneficiaries: 'BSEMC 2nd and 3rd year students',
  },
  label: null,
  code: 'OH-7K3P-ACR',
  qrContent: 'OH1.OH-7K3P-ACR.signed-content',
  ...patch,
});

async function partsOf(ctx: TemplateContext) {
  const files = unzipSync(new Uint8Array(await buildTaskTemplate(ctx)));
  const text = (name: string) => strFromU8(files[name]!);
  return { files, text };
}

// The first template loads the letterhead, the font and the QR reader (WebAssembly).
describe('task templates', { timeout: 20_000 }, () => {
  it('names the organization’s office and dates the event as people write them', () => {
    expect(officeName('The Animation Guild')).toBe('OFFICE OF THE ANIMATION GUILD');
    expect(officeName('Junior Philippine Institute of Civil Engineers')).toBe(
      'OFFICE OF THE JUNIOR PHILIPPINE INSTITUTE OF CIVIL ENGINEERS',
    );
    expect(longDate('2026-11-07')).toBe('November 7, 2026');
  });

  it('pre-fills the letterhead with the organization, project and event date', async () => {
    const { text } = await partsOf(context('PROPOSAL', { code: 'OH-7K3P-PROP' }));
    const body = text('word/document.xml');
    expect(body).not.toContain('{{BODY}}');
    expect(body).toContain('OFFICE OF THE ANIMATION GUILD');
    expect(body).toContain('PROJECT PROPOSAL');
    expect(body).toContain('MAKING MOVES: AN INTRO TO 3D ANIMATION WORKSHOP');
    expect(body).toContain('November 7, 2026');
    expect(body).toContain('President, TAG');
    // The 8.5 × 13 in long bond page of the official forms.
    expect(body).toContain('w:w="12240" w:h="18720"');
  });

  it('puts the QR in the header of every page, beside the logo', async () => {
    const { files, text } = await partsOf(context('ACR'));
    expect(text('word/header1.xml')).toContain('r:embed="rIdOrghiveQr"');
    expect(text('word/header1.xml')).toContain('descr="Orghive task code OH-7K3P-ACR"');
    expect(text('word/_rels/header1.xml.rels')).toContain('Target="media/orghive-qr.png"');
    expect(files['word/media/orghive-qr.png']!.subarray(1, 4)).toEqual(
      new Uint8Array([0x50, 0x4e, 0x47]),
    );
    // Form 7 is landscape, the rest portrait.
    expect(text('word/document.xml')).toContain('w:orient="landscape"');
    expect(orientationOf('ACR')).toBe('landscape');
    expect(orientationOf('FINANCIAL_REPORT')).toBe('portrait');
  });

  it('follows each official form', async () => {
    const acr = (await partsOf(context('ACR'))).text('word/document.xml');
    expect(acr).toContain('Form 7 – Accomplishment Report');
    expect(acr).toContain('Name of the Student Body Organization');
    for (const column of ['Input', 'Throughput', 'Output', 'Outcome', 'Impact', 'Pictures']) {
      expect(acr).toContain(`>${column}<`);
    }
    const fr = (await partsOf(context('FINANCIAL_REPORT'))).text('word/document.xml');
    expect(fr).toContain('Form 9 – Financial Report');
    expect(fr).toContain('I. CASH IN');
    expect(fr).toContain('TOTAL:');
    expect(fr).toContain('Total Cash Out:');
    const csc = (
      await partsOf(
        context('ACR', { organization: { name: 'CSC CCIS', acronym: 'CSC-CCIS', type: 'CSC' } }),
      )
    ).text('word/document.xml');
    expect(csc).toContain('Name of the Collegiate Student Council');
  });

  it('puts a letter’s label in its subject and escapes what people typed', async () => {
    const letter = (
      await partsOf(
        context('COMMUNICATION_LETTER', {
          label: 'Letter to the Dean <CCIS> & SAS',
          project: {
            name: 'Tom & Jerry Night',
            targetDate: '2026-11-07',
            location: 'Gym',
            beneficiaries: 'All',
          },
        }),
      )
    ).text('word/document.xml');
    expect(letter).toContain('[Letter to the Dean &lt;CCIS&gt; &amp; SAS]');
    expect(letter).toContain('Tom &amp; Jerry Night');
  });

  it('draws a QR that reads back to its content, with the code under it', async () => {
    const png = await renderQrImage('OH1.OH-7K3P-ACR.content', 'OH-7K3P-ACR');
    const [found] = await readBarcodes(new Uint8Array(png), { formats: ['QRCode'] });
    expect(found?.text).toBe('OH1.OH-7K3P-ACR.content');
  });

  it('carries no names from the official samples it was made from', async () => {
    for (const type of ['PROPOSAL', 'ACR'] as const) {
      const { files } = await partsOf(context(type));
      const all = Object.entries(files)
        .filter(([name]) => name.endsWith('.xml') || name.endsWith('.rels'))
        .map(([, bytes]) => strFromU8(bytes))
        .join('\n');
      expect(all).not.toMatch(/Galban|Amoguez|Bere\b|Ortiz|Jollie|C:\\Users/i);
    }
  });
});
