import { connect } from 'node:net';

export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface VirusScanner {
  scan(body: Uint8Array): Promise<ScanResult>;
}

/** clamd's INSTREAM chunk size; anything up to 2^32-1 is allowed, smaller keeps memory flat. */
const CHUNK = 64 * 1024;
const NUL = String.fromCharCode(0);

/** Parses clamd's INSTREAM reply. Anything but OK or FOUND is an error. */
export function parseClamdReply(raw: string): ScanResult {
  const text = raw.split(NUL).join('').trim();
  if (text === 'stream: OK') return { clean: true };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) return { clean: false, signature: found[1]! };
  throw new Error(`clamd: ${text || 'no reply'}`);
}

/**
 * Minimal clamd client over TCP (INSTREAM): sends the bytes in length-prefixed chunks and
 * reads one reply, "stream: OK" or "stream: <signature> FOUND". Anything else (size limit,
 * daemon error, timeout) throws, so the job is retried instead of a file passing unscanned.
 */
export function createClamavScanner({
  host,
  port,
  timeoutMs = 60_000,
}: {
  host: string;
  port: number;
  timeoutMs?: number;
}): VirusScanner {
  return {
    scan(body) {
      return new Promise<ScanResult>((resolve, reject) => {
        const socket = connect({ host, port });
        let reply = '';
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          fn();
        };
        const done = () => {
          try {
            const result = parseClamdReply(reply);
            finish(() => resolve(result));
          } catch (err) {
            finish(() => reject(err instanceof Error ? err : new Error(String(err))));
          }
        };
        socket.setTimeout(timeoutMs, () => finish(() => reject(new Error('clamd timed out'))));
        socket.on('error', (err) => finish(() => reject(err)));
        // The reply of a z-prefixed command ends with NUL; keep the socket open until then.
        socket.on('data', (chunk) => {
          reply += chunk.toString('utf8');
          if (reply.includes(NUL)) done();
        });
        socket.on('end', done);
        socket.on('connect', () => {
          socket.write(`zINSTREAM${NUL}`);
          for (let offset = 0; offset < body.length; offset += CHUNK) {
            const part = body.subarray(offset, offset + CHUNK);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(part.length);
            socket.write(size);
            socket.write(part);
          }
          // A zero-length chunk ends the stream; do not half-close, clamd would drop the reply.
          socket.write(Buffer.alloc(4));
        });
      });
    },
  };
}
