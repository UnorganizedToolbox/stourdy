import { describe, expect, it } from 'vitest';
import { isPublicPath } from './publicPaths';

describe('isPublicPath', () => {
  it('ログイン前に必要なページは公開', () => {
    for (const p of ['/login', '/signup', '/signup/verify', '/signup/pending', '/terms', '/privacy', '/auth/callback']) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it('それ以外はログインが必要', () => {
    for (const p of ['/', '/timer', '/admin', '/settings', '/auth/signout']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it('名前が前方一致するだけのページは公開しない', () => {
    expect(isPublicPath('/termsx')).toBe(false);
    expect(isPublicPath('/privacy-admin')).toBe(false);
    expect(isPublicPath('/loginhack')).toBe(false);
  });
});
