// 運営者名・問い合わせ先など、デプロイする人ごとに異なる値。
// ソースに直接書かず環境変数から読むので、リポジトリを複製した人に作者の情報が残らない。
// NEXT_PUBLIC_ はビルド時に埋め込まれるため、値を変えたら再デプロイが必要。
export const OPERATOR_NAME = process.env.NEXT_PUBLIC_OPERATOR_NAME?.trim() || '運営者';
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;
