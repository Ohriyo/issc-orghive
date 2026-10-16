import type { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '#src/config';

export interface StoredObject {
  sizeBytes: number;
  contentType: string | undefined;
}

/**
 * Object storage port. File bytes go browser <-> storage through pre-signed URLs and never
 * through the API (CLAUDE.md); only the worker reads them, to check and process uploads.
 */
export interface Storage {
  /** A PUT that only accepts exactly this Content-Type (and, where the server enforces it, length). */
  presignPut(
    key: string,
    file: { contentType: string; sizeBytes: number },
    expiresInSeconds: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** A GET for a private object, served with this file name and type. */
  presignGet(
    key: string,
    file: { filename: string; contentType: string; disposition: 'attachment' | 'inline' },
    expiresInSeconds: number,
  ): Promise<string>;
  /** Size and type of an object, or null if it does not exist. */
  head(key: string): Promise<StoredObject | null>;
  read(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Copies then deletes (S3 has no rename). */
  move(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;
}

type StorageConfig = Pick<
  Config,
  | 'S3_ENDPOINT'
  | 'S3_PUBLIC_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY'
  | 'S3_SECRET_KEY'
  | 'S3_FORCE_PATH_STYLE'
>;

/** RFC 6266 file name for Content-Disposition, safe for any characters. */
function disposition(type: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createS3Storage(config: StorageConfig): Storage {
  const credentials = { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY };
  const base = {
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials,
  };
  const s3 = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
  // URLs handed to browsers must use the address browsers can reach.
  const publicS3 = new S3Client({
    ...base,
    endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT,
  });
  const Bucket = config.S3_BUCKET;

  return {
    async presignPut(key, file, expiresIn) {
      const command = new PutObjectCommand({
        Bucket,
        Key: key,
        ContentType: file.contentType,
        ContentLength: file.sizeBytes,
      });
      const url = await getSignedUrl(publicS3, command, {
        expiresIn,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      return { url, headers: { 'Content-Type': file.contentType } };
    },

    presignGet(key, file, expiresIn) {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentType: file.contentType,
        ResponseContentDisposition: disposition(file.disposition, file.filename),
      });
      return getSignedUrl(publicS3, command, { expiresIn });
    },

    async head(key) {
      try {
        const res = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (err) {
        if (err instanceof NotFound) return null;
        if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async read(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as Readable) chunks.push(Buffer.from(chunk as Uint8Array));
      return Buffer.concat(chunks);
    },

    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async move(from, to) {
      await s3.send(
        new CopyObjectCommand({
          Bucket,
          Key: to,
          CopySource: `${Bucket}/${encodeURIComponent(from)}`,
        }),
      );
      await s3.send(new DeleteObjectCommand({ Bucket, Key: from }));
    },

    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
