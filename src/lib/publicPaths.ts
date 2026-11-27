// ログインしていなくても開けるページ。それ以外は middleware が /login に送る。
// - /terms・/privacy: ログイン画面で「同意したものとみなす」と示している以上、ログイン前に読めなければならない
// - /auth/callback: 確認メールのリンク先。ログイン前に開かれ、ここでセッションを作る
const PUBLIC_PREFIXES = ['/login', '/signup', '/terms', '/privacy', '/auth/callback'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
