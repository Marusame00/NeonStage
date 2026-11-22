import { describe, expect, it } from 'vitest';
import { containsSecretLikeKeys, stripSecrets } from '../src/shared/secrets';

describe('stripSecrets', () => {
  it('removes nested secret keys and keeps the rest', () => {
    const source = {
      name: 'project',
      accessToken: 'a',
      nested: {
        refresh_token: 'b',
        clientSecret: 'c',
        keep: 1,
        deeper: [{ password: 'd', value: 'e' }],
      },
      list: [{ apiKey: 'f', label: 'g' }],
      authorization: 'h',
    };

    const stripped = stripSecrets(source);
    expect(stripped).toEqual({
      name: 'project',
      nested: { keep: 1, deeper: [{ value: 'e' }] },
      list: [{ label: 'g' }],
    });
    expect(source.accessToken).toBe('a');
  });

  it('detects secret-like keys', () => {
    expect(containsSecretLikeKeys({ a: { accessToken: 'x' } })).toBe(true);
    expect(containsSecretLikeKeys({ a: { safe: 'x' } })).toBe(false);
    expect(containsSecretLikeKeys([{ refreshToken: 'x' }])).toBe(true);
  });
});
