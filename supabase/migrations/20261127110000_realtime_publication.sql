-- 2026-11-27: リアルタイム更新が要るテーブルを Realtime の配信対象にする。
-- - questions: 質問箱。0006_enable_realtime.sql で追加していたが、本番では配信対象から外れていた
--   (外れた経緯は記録がない。通知のたびに router.refresh() でページ全体が取り直され、ポモドーロ
--   タイマーを巻き込んでいたため外した可能性がある)。アプリは通知を受けても質問欄だけを取り直す
--   ように変えたので、戻してもタイマーには影響しない(src/lib/useRealtimeReload.ts)。
-- - pomodoro_events: 教師の「団体の学習状況」(集中中・休憩中の表示)を更新するため。
-- - teacher_inquiries: 教師⇄管理者の問い合わせを更新するため。
-- 届く通知は購読者が RLS で読める行に限られる。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['questions', 'pomodoro_events', 'teacher_inquiries'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
