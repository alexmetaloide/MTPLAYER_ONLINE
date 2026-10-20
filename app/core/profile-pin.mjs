const DEFAULT_ITERATIONS = 60000;

export function normalizeProfilePin(value) {
  const pin = String(value ?? '').replace(/\D/g, '').slice(0, 4);
  if (!/^\d{4}$/.test(pin)) throw new Error('O PIN deve ter exatamente 4 dígitos.');
  return pin;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function derivePinHash(pin, saltBase64, iterations) {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('A proteção por PIN não está disponível neste dispositivo.');
  }
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizeProfilePin(pin)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: base64ToBytes(saltBase64),
    iterations,
    hash: 'SHA-256'
  }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

export function hasProfilePin(profile) {
  return Boolean(profile?.pinHash && profile?.pinSalt && Number(profile?.pinIterations) > 0);
}

export async function createProfilePin(pin) {
  const normalized = normalizeProfilePin(pin);
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('A proteção por PIN não está disponível neste dispositivo.');
  }
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const pinSalt = bytesToBase64(salt);
  const pinIterations = DEFAULT_ITERATIONS;
  const pinHash = await derivePinHash(normalized, pinSalt, pinIterations);
  return { pinHash, pinSalt, pinIterations };
}

export async function verifyProfilePin(profile, pin) {
  if (!hasProfilePin(profile)) return true;
  const candidate = await derivePinHash(pin, profile.pinSalt, Number(profile.pinIterations));
  if (candidate.length !== profile.pinHash.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ profile.pinHash.charCodeAt(index);
  }
  return difference === 0;
}
