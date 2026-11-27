-- 2026-11-27: 質問箱(questions)を Realtime の配信対象に戻す。
-- 0006_enable_realtime.sql で追加していたが、本番では配信対象から外れていた(外れた経緯は記録がない。
-- 通知のたびに router.refresh() でページ全体が取り直され、ポモドーロタイマーを巻き込んでいたため
-- 外した可能性がある)。アプリは通知を受けても質問欄だけを取り直すように変えたので、戻しても
-- タイマーには影響しない(src/lib/useRealtimeReload.ts)。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'questions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.questions;
  END IF;
END $$;
