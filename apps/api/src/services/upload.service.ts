import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  MAX_UPLOAD_BYTES,
  type UploadUrlRequest,
  type UploadUrlResponse,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Storage } from '#src/lib/storage';
import type { UploadIntentRepository } from '#src/repositories/upload-intent.repository';
import type { OrgRef } from '#src/services/access.service';

/** CLAUDE.md: pre-signed URLs live 5 minutes. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export interface UploadedFile {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadServiceDeps {
  intents: Pick<UploadIntentRepository, 'create' | 'claim'>;
  storage: Pick<Storage, 'presignPut' | 'head' | 'delete'>;
  now?: () => Date;
  newId?: () => string;
}

function invalidUpload(message: string) {
  return new AppError(400, ErrorCode.VALIDATION_ERROR, message);
}

/**
 * Pre-signed uploads: the browser PUTs bytes straight to storage, never through the API.
 * Each URL is recorded as an intent so a document can only claim an object this user was
 * given for this organization, once.
 */
export function createUploadService({
  intents,
  storage,
  now = () => new Date(),
  newId = randomUUID,
}: UploadServiceDeps) {
  return {
    /** A 5-minute PUT URL to a fresh random key under the organization's upload prefix. */
    async issueUrl(
      userId: string,
      org: OrgRef,
      file: UploadUrlRequest,
    ): Promise<UploadUrlResponse> {
      const key = `uploads/${org.id}/${newId()}`;
      const expiresAt = new Date(now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000);
      await intents.create({
        key,
        organizationId: org.id,
        userId,
        originalFilename: file.filename,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        expiresAt,
      });
      const { url, headers } = await storage.presignPut(
        key,
        { contentType: file.contentType, sizeBytes: file.sizeBytes },
        UPLOAD_URL_TTL_SECONDS,
      );
      return { uploadKey: key, url, method: 'PUT', headers, expiresAt: expiresAt.toISOString() };
    },

    /**
     * Claims an uploaded object for a new document or version: it must be this user's
     * unused intent for this organization, and the stored object must match what was
     * declared. A mismatching object is deleted. 400 otherwise.
     */
    async claim(userId: string, org: OrgRef, uploadKey: string): Promise<UploadedFile> {
      const stored = await storage.head(uploadKey);
      if (!stored) throw invalidUpload('The file has not finished uploading. Upload it again.');

      const intent = await intents.claim(uploadKey, { userId, organizationId: org.id }, now());
      if (!intent) {
        throw invalidUpload(
          'This upload is unknown, expired or already used. Upload the file again.',
        );
      }
      if (
        stored.sizeBytes !== intent.sizeBytes ||
        stored.sizeBytes > MAX_UPLOAD_BYTES ||
        stored.contentType !== intent.contentType
      ) {
        await storage.delete(uploadKey);
        throw invalidUpload('The uploaded file does not match what was declared. Upload it again.');
      }
      return {
        storageKey: uploadKey,
        originalFilename: intent.originalFilename,
        mimeType: intent.contentType,
        sizeBytes: intent.sizeBytes,
      };
    },
  };
}

export type UploadService = ReturnType<typeof createUploadService>;
