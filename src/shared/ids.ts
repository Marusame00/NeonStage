const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 12;

interface RandomSource {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

export function newId(prefix?: string): string {
  const bytes = new Uint8Array(ID_LENGTH);
  const source = (globalThis as { crypto?: RandomSource }).crypto;
  if (source && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < ID_LENGTH; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  let body = '';
  for (let i = 0; i < ID_LENGTH; i += 1) body += ALPHABET[bytes[i]! % ALPHABET.length];

  if (!prefix) return body;
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return safePrefix ? `${safePrefix}-${body}` : body;
}
