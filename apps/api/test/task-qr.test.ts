import { describe, expect, it } from 'vitest';
import { isTaskCode } from '@orghive/shared';
import { createTaskQr, generateTaskCode } from '#src/lib/task-qr';

const SECRET = Buffer.alloc(32, 1).toString('base64');
const PAYLOAD = {
  code: 'OH-7K3P-ACR',
  taskId: '0195f3c0-0000-7000-8000-0000000000c1',
  organizationId: '0195f3c0-0000-7000-8000-0000000000a1',
};

describe('task QR codes', () => {
  const qr = createTaskQr(SECRET);

  it('signs a payload and reads it back', () => {
    const content = qr.contentOf(PAYLOAD);
    expect(content.startsWith('OH1.OH-7K3P-ACR.')).toBe(true);
    // Short enough for a QR whose modules survive printing at under an inch.
    expect(content.length).toBeLessThan(90);
    expect(qr.verify(content)).toEqual(PAYLOAD);
  });

  it('refuses a forged or altered QR', () => {
    const content = qr.contentOf(PAYLOAD);
    const parts = content.split('.');
    // Another organization's id under the same signature.
    const other = createTaskQr(SECRET).contentOf({
      ...PAYLOAD,
      organizationId: '0195f3c0-0000-7000-8000-0000000000a2',
    });
    const swapped = [...parts.slice(0, 3), other.split('.')[3], parts[4]].join('.');
    expect(qr.verify(swapped)).toBeNull();
    // Signed with another key.
    expect(createTaskQr(Buffer.alloc(32, 2).toString('base64')).verify(content)).toBeNull();
    // Truncated, foreign or empty content.
    expect(qr.verify(content.slice(0, -1))).toBeNull();
    expect(qr.verify('https://example.com')).toBeNull();
    expect(qr.verify('')).toBeNull();
  });

  it('draws codes in the printed format', () => {
    const code = generateTaskCode('FINANCIAL_REPORT');
    expect(isTaskCode(code)).toBe(true);
    expect(code.endsWith('-FR')).toBe(true);
    expect(generateTaskCode('PROPOSAL', () => 0)).toBe('OH-0000-PROP');
  });
});
