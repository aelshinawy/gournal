const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(nowMs?: number): string {
  if (nowMs !== undefined && !(Number.isSafeInteger(nowMs) && nowMs >= 0 && nowMs <= 2 ** 48 - 1)) {
    throw new RangeError('nowMs must be a non-negative safe integer');
  }
  let time = nowMs ?? Date.now();
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ALPHABET[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  // 16 chars x 5 bits = 80 random bits. Use one byte per char and keep the low 5 bits.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let randomPart = '';
  for (const b of bytes) randomPart += ALPHABET[b & 31];
  return timePart + randomPart;
}

export const shortId = (id: string): string => id.slice(-8);
