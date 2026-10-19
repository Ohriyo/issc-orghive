import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createClamavScanner, parseClamdReply } from '#src/lib/clamav';

const HOST = process.env.CLAMAV_HOST ?? 'localhost';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);

/** The EICAR test string, assembled in memory so no file in the repo ever contains it. */
function eicar(): Buffer {
  return Buffer.from(
    [
      'X5O!P%@AP[4',
      String.fromCharCode(92),
      'PZX54(P^)7CC)7}$EICAR',
      '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    ].join(''),
  );
}

/** clamd runs locally (docker compose) but not in CI; the live tests need it. */
async function clamdReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: HOST, port: PORT });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

const live = await clamdReachable();

describe('parseClamdReply', () => {
  it('reads OK and FOUND replies and treats anything else as an error', () => {
    const nul = String.fromCharCode(0);
    expect(parseClamdReply(`stream: OK${nul}`)).toEqual({ clean: true });
    expect(parseClamdReply(`stream: Eicar-Test-Signature FOUND${nul}`)).toEqual({
      clean: false,
      signature: 'Eicar-Test-Signature',
    });
    expect(() => parseClamdReply('INSTREAM size limit exceeded. ERROR')).toThrow(/size limit/);
    expect(() => parseClamdReply('')).toThrow(/no reply/);
  });
});

describe.skipIf(!live)('ClamAV scanner against a running clamd', () => {
  const scanner = createClamavScanner({ host: HOST, port: PORT });

  it('passes clean bytes', async () => {
    expect(await scanner.scan(Buffer.from('%PDF-1.7 an ordinary file'))).toEqual({ clean: true });
  });

  it('detects the EICAR test file', async () => {
    expect(await scanner.scan(eicar())).toEqual({
      clean: false,
      signature: 'Eicar-Test-Signature',
    });
  });

  it('streams large files in chunks', async () => {
    expect(await scanner.scan(Buffer.alloc(3 * 1024 * 1024, 1))).toEqual({ clean: true });
  });
});
