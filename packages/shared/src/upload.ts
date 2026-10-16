import { z } from 'zod';

/** CLAUDE.md: uploads are at most 25 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * The upload allow-list (CLAUDE.md): MIME type and the file extensions that go with it.
 * The worker later checks the file's magic bytes against the declared type.
 */
export const UPLOAD_TYPES = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
} as const satisfies Record<string, readonly string[]>;

export type UploadContentType = keyof typeof UPLOAD_TYPES;
export const UPLOAD_CONTENT_TYPES = Object.keys(UPLOAD_TYPES) as UploadContentType[];
export const uploadContentTypeSchema = z.enum(
  UPLOAD_CONTENT_TYPES as [UploadContentType, ...UploadContentType[]],
);

/** For <input accept>: ".pdf,.docx,…". */
export const UPLOAD_ACCEPT = Object.values(UPLOAD_TYPES)
  .flat()
  .map((ext) => `.${ext}`)
  .join(',');

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** The allowed type for a file name's extension, or undefined. */
export function contentTypeForFilename(filename: string): UploadContentType | undefined {
  const ext = extensionOf(filename);
  return UPLOAD_CONTENT_TYPES.find((type) =>
    (UPLOAD_TYPES[type] as readonly string[]).includes(ext),
  );
}

/** A display name only (never a path): no separators or control characters. */
export const uploadFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (name) =>
      ![...name].some(
        (c) => c === '/' || c === '\\' || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f,
      ),
    'The file name cannot contain slashes or control characters',
  );

/**
 * POST /organizations/:slug/documents/upload-url. The type and size are checked here and
 * again by storage: the pre-signed PUT only accepts exactly this Content-Type and length.
 */
export const uploadUrlRequestSchema = z
  .strictObject({
    filename: uploadFilenameSchema,
    contentType: uploadContentTypeSchema,
    sizeBytes: z
      .number()
      .int()
      .min(1, 'The file is empty')
      .max(MAX_UPLOAD_BYTES, 'Files can be at most 25 MB'),
  })
  .refine((body) => contentTypeForFilename(body.filename) === body.contentType, {
    path: ['filename'],
    message: 'The file extension does not match its type. Allowed: PDF, DOCX, XLSX, PPTX, JPG, PNG',
  });
export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;

/** Storage keys handed out for uploads: uploads/<organization id>/<random uuid>. */
export const uploadKeySchema = z
  .string()
  .regex(/^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/, 'Not an upload key from this server');

export const uploadUrlResponseSchema = z
  .object({
    uploadKey: uploadKeySchema,
    /** Pre-signed PUT, valid for 5 minutes. */
    url: z.url(),
    method: z.literal('PUT'),
    /** Headers the PUT must send exactly, or storage refuses it. */
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'UploadUrlResponse' });
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;

/** Up to 10 tags, lowercased, letters/numbers/spaces/hyphens, duplicates dropped. */
export const documentTagsSchema = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(30)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} -]*$/u, 'Tags use letters, numbers, spaces and hyphens'),
  )
  .max(10, 'At most 10 tags')
  .transform((tags) => [...new Set(tags)]);
