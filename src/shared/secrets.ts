const SECRET_KEY = /token|secret|password|refresh|authorization|apiKey|clientSecret/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneWithoutSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneWithoutSecrets(entry)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = cloneWithoutSecrets(entry);
    }
    return out as unknown as T;
  }
  return value;
}

export function stripSecrets<T>(value: T): T {
  return cloneWithoutSecrets(value);
}

export function containsSecretLikeKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsSecretLikeKeys(entry));
  if (isPlainObject(value)) {
    return Object.entries(value).some(
      ([key, entry]) => SECRET_KEY.test(key) || containsSecretLikeKeys(entry),
    );
  }
  return false;
}
