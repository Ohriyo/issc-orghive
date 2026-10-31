import { beforeEach, describe, expect, it } from 'vitest';
import { HANDBOOK_DOCUMENT_TYPE, handbookTitle } from '@orghive/shared';
import { createHandbookRepository } from '#src/repositories/handbook.repository';
import { buildWorld, resetDb, testDb, type World } from '../db';

const db = testDb();
const handbooks = createHandbookRepository(db);
let world: World;
let typeId: string;

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  typeId = (await db.documentType.create({ data: HANDBOOK_DOCUMENT_TYPE })).id;
});

function create(academicYear: string) {
  return handbooks.create(academicYear, {
    organizationId: world.orgs.issc.id,
    typeId,
    title: handbookTitle(academicYear),
    academicYear,
    status: 'scanning',
    visibility: 'public',
    createdById: world.users.issc.id,
    firstVersion: {
      storageKey: `uploads/${academicYear}`,
      originalFilename: 'handbook.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
      uploadedById: world.users.issc.id,
      actingAs: 'Ana Reyes',
    },
  });
}

const currentYears = async () =>
  (await db.handbookEdition.findMany({ where: { isCurrent: true } })).map((e) => e.academicYear);

describe('handbookRepository: the current edition', () => {
  it('makes the very first edition current, and later ones not', async () => {
    expect(await create('2025-2026')).toMatchObject({ isCurrent: true });
    expect(await create('2026-2027')).toMatchObject({ isCurrent: false });
    expect(await currentYears()).toEqual(['2025-2026']);
  });

  it('keeps exactly one edition current when another is made current', async () => {
    await create('2024-2025');
    await create('2025-2026');
    await create('2026-2027');
    await handbooks.setCurrent('2026-2027');
    expect(await currentYears()).toEqual(['2026-2027']);
    await handbooks.setCurrent('2025-2026');
    expect(await currentYears()).toEqual(['2025-2026']);
    // Making the current one current again changes nothing.
    await handbooks.setCurrent('2025-2026');
    expect(await currentYears()).toEqual(['2025-2026']);
  });

  it('refuses a second current edition at the database, whatever the code does', async () => {
    await create('2025-2026');
    await create('2026-2027');
    await expect(
      db.handbookEdition.update({ where: { academicYear: '2026-2027' }, data: { isCurrent: true } }),
    ).rejects.toThrow();
    expect(await currentYears()).toEqual(['2025-2026']);
  });
});
