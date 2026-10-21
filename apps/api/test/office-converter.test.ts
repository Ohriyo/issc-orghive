import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConversionRejectedError,
  createGotenbergConverter,
  isOfficeType,
} from '#src/lib/office-converter';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A stand-in for Gotenberg: answers with the status the test sets, and records the form. */
let status = 200;
let lastBody = '';
let lastPath = '';
let server: Server;
let url: string;

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    lastPath = req.url ?? '';
    void readAll(req).then((body) => {
      lastBody = body;
      res.statusCode = status;
      res.end(status === 200 ? '%PDF-1.7 converted' : 'LibreOffice said no');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('Gotenberg converter', () => {
  it('posts the file under a safe name with its real extension and returns the PDF', async () => {
    status = 200;
    const pdf = await createGotenbergConverter({ url }).toPdf(Buffer.from('docx bytes'), DOCX);
    expect(pdf.toString()).toBe('%PDF-1.7 converted');
    expect(lastPath).toBe('/forms/libreoffice/convert');
    expect(lastBody).toContain('name="files"; filename="document.docx"');
    expect(lastBody).toContain('docx bytes');
  });

  it('treats a 400 as the file’s fault (no retry), other failures as retryable', async () => {
    const converter = createGotenbergConverter({ url });
    status = 400;
    await expect(converter.toPdf(Buffer.from('x'), DOCX)).rejects.toBeInstanceOf(
      ConversionRejectedError,
    );
    for (const code of [500, 503]) {
      status = code;
      const err = await converter.toPdf(Buffer.from('x'), DOCX).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ConversionRejectedError);
    }
  });

  it('refuses types LibreOffice is not asked to convert', async () => {
    await expect(
      createGotenbergConverter({ url }).toPdf(Buffer.from('x'), 'application/pdf'),
    ).rejects.toBeInstanceOf(ConversionRejectedError);
    expect(isOfficeType(DOCX)).toBe(true);
    expect(isOfficeType('image/png')).toBe(false);
  });
});
