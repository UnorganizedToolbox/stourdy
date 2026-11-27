import { createAdminClient } from '@/utils/supabase/admin';

// 質問箱の画像(qa_images バケット)は非公開。DB の image_url にはバケット内のパスを保存し、
// 表示するときにサーバー側で期限付きの署名URLへ差し替える。
// 誰が見てよいかは、呼び出し側が利用者本人の権限(RLS)で questions を取得した時点で決まって
// いる。ここでは取得できた行の画像にだけ署名するので、管理者キーを使っても見える範囲は広がらない。
// サーバーコンポーネント・サーバーアクション以外から呼ばないこと。

const BUCKET = 'qa_images';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// 以前は公開URL(…/object/public/qa_images/<path>)を保存していたので、その形式からもパスを取り出す。
export function qaImagePath(stored: string): string | null {
  const marker = `/${BUCKET}/`;
  const idx = stored.indexOf(marker);
  if (idx !== -1) return stored.slice(idx + marker.length).split('?')[0] || null;
  if (/^https?:\/\//.test(stored)) return null;
  return stored || null;
}

type WithImage = { image_url?: string | null };
type QuestionLike = WithImage & { replies?: unknown };

export async function signQaImages<T extends QuestionLike>(rows: T[]): Promise<T[]> {
  const paths = new Set<string>();
  const collect = (item: WithImage) => {
    const p = item.image_url ? qaImagePath(item.image_url) : null;
    if (p) paths.add(p);
  };
  for (const row of rows) {
    collect(row);
    for (const r of (Array.isArray(row.replies) ? row.replies : []) as WithImage[]) collect(r);
  }
  if (paths.size === 0) return rows;

  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUrls([...paths], SIGNED_URL_TTL_SECONDS);
  if (error) console.error('Failed to sign QA image URLs', error);

  const signed = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl);
  }
  const resolve = <U extends WithImage>(item: U): U => {
    if (!item.image_url) return item;
    const p = qaImagePath(item.image_url);
    return { ...item, image_url: (p && signed.get(p)) || null };
  };

  return rows.map((row) => {
    const out = resolve(row);
    if (Array.isArray(row.replies)) {
      return { ...out, replies: (row.replies as WithImage[]).map(resolve) };
    }
    return out;
  });
}
