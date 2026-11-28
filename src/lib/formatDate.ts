// 日付・時刻のユーザー向け表示を、SSR(サーバー)とクライアントで常に同じ文字列になるよう、
// 固定のロケール・タイムゾーンでフォーマットする。
//
// `toLocaleDateString()`/`toLocaleString()`/`toLocaleTimeString()`をロケール指定なしで
// 呼ぶと、実行環境の既定ロケール(Vercelのサーバー側Node.jsランタイムの既定と、利用者の
// ブラウザの既定は一致するとは限らない)によって出力形式が変わりうる。クライアント
// コンポーネントの初回レンダリング結果(SSR)とハイドレーション時のクライアント側
// レンダリング結果がこれで食い違うと、Reactのハイドレーションエラー(#418: テキスト内容の
// 不一致)を引き起こす(2026-10-11、`/timer`・`/admin`の両方で毎回再現することを確認して
// 特定した)。ここで明示的にロケール・タイムゾーンを固定することで、実行環境に関わらず
// 常に同じ文字列になるようにする。

const LOCALE = 'ja-JP';
const JST_TIME_ZONE = 'Asia/Tokyo';

export function formatJstDate(input: string | number | Date): string {
  return new Date(input).toLocaleDateString(LOCALE, { timeZone: JST_TIME_ZONE });
}

export function formatJstTime(input: string | number | Date): string {
  return new Date(input).toLocaleTimeString(LOCALE, { timeZone: JST_TIME_ZONE });
}

export function formatJstDateTime(input: string | number | Date): string {
  return new Date(input).toLocaleString(LOCALE, { timeZone: JST_TIME_ZONE });
}

// 日本時間の「今日」の0時を ISO 文字列で返す。サーバー(Vercel は UTC)で `setHours(0,0,0,0)` を
// 使うと UTC の0時(日本時間の9時)になり、朝9時より前の記録が「今日」から漏れる(2026-11-28、
// 団体の学習状況の「今日N回」が生徒側とずれていた)。日本時間に夏時間はないので固定の +9 時間で計算する。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfJstDayISO(now: Date = new Date()): string {
  const jstMs = now.getTime() + JST_OFFSET_MS;
  return new Date(Math.floor(jstMs / DAY_MS) * DAY_MS - JST_OFFSET_MS).toISOString();
}
