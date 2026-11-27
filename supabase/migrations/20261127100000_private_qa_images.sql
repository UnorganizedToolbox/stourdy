-- 2026-11-27: 質問箱の画像(qa_images)を非公開にする。
-- これまでは公開バケットで、URL を知っていれば誰でも画像を見られた(未成年の生徒の画像を含む)。
-- 以後、アプリはサーバー側で、利用者が RLS で読める質問の画像にだけ期限付きの署名URLを発行する
-- (src/lib/qaImages.ts)。DB の image_url に残っている旧形式の公開URLも、パスに読み替えて署名する。
UPDATE storage.buckets SET public = false WHERE id = 'qa_images';

DROP POLICY IF EXISTS "Anyone can view QA images" ON storage.objects;
