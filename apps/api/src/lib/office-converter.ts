/** Converts DOCX, XLSX and PPTX to PDF so their pages can be rendered (worker only). */
export interface OfficeConverter {
  /** Throws ConversionRejectedError when the file itself cannot be converted. */
  toPdf(body: Buffer, mimeType: string): Promise<Buffer>;
}

/** LibreOffice refused the document: retrying sends the same file and fails the same way. */
export class ConversionRejectedError extends Error {
  override name = 'ConversionRejectedError';
}

/** The extension LibreOffice reads the format from; never the uploader's file name. */
const EXTENSION: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export function isOfficeType(mimeType: string): boolean {
  return mimeType in EXTENSION;
}

/** A large spreadsheet can take a while; past this the job fails and BullMQ retries it. */
const CONVERT_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Headless LibreOffice behind Gotenberg's HTTP API (docker-compose `gotenberg`). A 400 means
 * LibreOffice rejected the file (permanent); a 500, 503 or network error is worth retrying.
 */
export function createGotenbergConverter({ url }: { url: string }): OfficeConverter {
  const endpoint = new URL('/forms/libreoffice/convert', url);
  return {
    async toPdf(body, mimeType) {
      const ext = EXTENSION[mimeType];
      if (!ext) throw new ConversionRejectedError(`Not an Office type: ${mimeType}`);
      const form = new FormData();
      form.append('files', new Blob([new Uint8Array(body)]), `document.${ext}`);
      const res = await fetch(endpoint, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
      });
      if (res.status === 400) {
        throw new ConversionRejectedError(`LibreOffice rejected the file: ${await res.text()}`);
      }
      if (!res.ok) throw new Error(`Gotenberg answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
