import { describe, expect, it, vi } from 'vitest';
import type { UploadIntent } from '#src/repositories/upload-intent.repository';
import { createUploadService } from '#src/services/upload.service';

const ORG = { id: '0195f3c0-0000-7000-8000-0000000000aa', slug: 'jpice' };
const NOW = new Date('2026-10-16T00:00:00Z');
const KEY = `uploads/${ORG.id}/0195f3c0-0000-7000-8000-0000000000f1`;

function intent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  return {
    key: KEY,
    organizationId: ORG.id,
    userId: 'u1',
    originalFilename: 'proposal.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1000,
    expiresAt: new Date(NOW.getTime() + 300_000),
    usedAt: NOW,
    ...overrides,
  };
}

interface SetupOptions {
  stored?: { sizeBytes: number; contentType: string } | null;
  claimed?: UploadIntent | null;
}

function setup(options: SetupOptions = {}) {
  const { stored = { sizeBytes: 1000, contentType: 'application/pdf' }, claimed = intent() } =
    options;
  const intents = {
    create: vi.fn(() => Promise.resolve()),
    claim: vi.fn(() => Promise.resolve(claimed)),
  };
  const storage = {
    presignPut: vi.fn(() =>
      Promise.resolve({
        url: 'https://storage.test/put',
        headers: { 'Content-Type': 'application/pdf' },
      }),
    ),
    head: vi.fn(() => Promise.resolve(stored)),
    delete: vi.fn(() => Promise.resolve()),
  };
  const service = createUploadService({
    intents,
    storage,
    now: () => NOW,
    newId: () => '0195f3c0-0000-7000-8000-0000000000f1',
  });
  return { service, intents, storage };
}

describe('uploadService.issueUrl', () => {
  it('records an intent and returns a 5-minute PUT to a random key under the organization', async () => {
    const { service, intents, storage } = setup();
    const res = await service.issueUrl('u1', ORG, {
      filename: 'proposal.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
    });
    expect(intents.create).toHaveBeenCalledWith({
      key: KEY,
      organizationId: ORG.id,
      userId: 'u1',
      originalFilename: 'proposal.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      expiresAt: new Date('2026-10-16T00:05:00Z'),
    });
    expect(storage.presignPut).toHaveBeenCalledWith(
      KEY,
      { contentType: 'application/pdf', sizeBytes: 1000 },
      300,
    );
    expect(res).toEqual({
      uploadKey: KEY,
      url: 'https://storage.test/put',
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      expiresAt: '2026-10-16T00:05:00.000Z',
    });
  });
});

describe('uploadService.claim', () => {
  it('returns the stored file when the intent and the object match', async () => {
    const { service, intents } = setup();
    expect(await service.claim('u1', ORG, KEY)).toEqual({
      storageKey: KEY,
      originalFilename: 'proposal.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
    });
    expect(intents.claim).toHaveBeenCalledWith(KEY, { userId: 'u1', organizationId: ORG.id }, NOW);
  });

  it('400s before claiming when nothing was uploaded, so the user can retry', async () => {
    const { service, intents } = setup({ stored: null });
    await expect(service.claim('u1', ORG, KEY)).rejects.toMatchObject({ status: 400 });
    expect(intents.claim).not.toHaveBeenCalled();
  });

  it('400s an unknown, expired, used or foreign intent', async () => {
    const { service } = setup({ claimed: null });
    await expect(service.claim('u1', ORG, KEY)).rejects.toMatchObject({ status: 400 });
  });

  it('deletes and refuses an object that differs from what was declared', async () => {
    const bigger = setup({ stored: { sizeBytes: 5000, contentType: 'application/pdf' } });
    await expect(bigger.service.claim('u1', ORG, KEY)).rejects.toMatchObject({ status: 400 });
    expect(bigger.storage.delete).toHaveBeenCalledWith(KEY);

    const retyped = setup({ stored: { sizeBytes: 1000, contentType: 'text/html' } });
    await expect(retyped.service.claim('u1', ORG, KEY)).rejects.toMatchObject({ status: 400 });
    expect(retyped.storage.delete).toHaveBeenCalledWith(KEY);
  });
});
