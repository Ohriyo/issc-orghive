import { beforeEach, describe, expect, it } from 'vitest';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { buildWorld, resetDb, testDb, type World } from '../db';

const db = testDb();
const intents = createUploadIntentRepository(db);
let world: World;
const NOW = new Date('2026-10-16T00:00:00Z');

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
});

async function intent(expiresInMs = 300_000) {
  const key = `uploads/${world.orgs.jpice.id}/${crypto.randomUUID()}`;
  await intents.create({
    key,
    organizationId: world.orgs.jpice.id,
    userId: world.users.officer.id,
    originalFilename: 'p.pdf',
    contentType: 'application/pdf',
    sizeBytes: 100,
    expiresAt: new Date(NOW.getTime() + expiresInMs),
  });
  return key;
}

describe('uploadIntentRepository.claim', () => {
  const owner = () => ({ userId: world.users.officer.id, organizationId: world.orgs.jpice.id });

  it('claims an intent once, for its owner and organization only', async () => {
    const key = await intent();
    expect(
      await intents.claim(key, { ...owner(), userId: world.users.governor.id }, NOW),
    ).toBeNull();
    expect(
      await intents.claim(key, { ...owner(), organizationId: world.orgs.psme.id }, NOW),
    ).toBeNull();
    expect(await intents.claim(key, owner(), NOW)).toMatchObject({
      key,
      sizeBytes: 100,
      usedAt: NOW,
    });
    expect(await intents.claim(key, owner(), NOW)).toBeNull();
  });

  it('never claims an expired intent, and lists abandoned ones for the sweep', async () => {
    const expired = await intent(-1);
    expect(await intents.claim(expired, owner(), NOW)).toBeNull();
    const used = await intent();
    await intents.claim(used, owner(), NOW);

    expect(await intents.listAbandoned(NOW)).toEqual([expired]);
    await intents.deleteMany([expired]);
    expect(await db.uploadIntent.count()).toBe(1);
  });
});
