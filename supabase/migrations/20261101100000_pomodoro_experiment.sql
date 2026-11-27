-- 2026-11-01: ポモドーロ時間可変化の実験用インフラ。
-- 固定25/5/15分にも、集中度スコア等による動的調整にも実証的根拠がないことが文献調査で
-- 判明した(CLAUDE.local.mdのポモドーロRL計画の項を参照)。いきなりアルゴリズムを実装する
-- のではなく、まず作業時間・休憩時間を範囲内でランダムに変えてログを集め、本当に差が出るか
-- をこのアプリの利用データで検証する実験フェーズを設ける。今は誰にも有効化しない
-- (pomodoro_experiment_enabled はデフォルトfalseで、既存ユーザーの挙動には一切影響しない)。

-- 実験モードの有効化フラグ。本人の同意の上、該当アカウントだけ手動でtrueにする想定。
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pomodoro_experiment_enabled boolean NOT NULL DEFAULT false;

-- 自由記録ログ: ポモドーロの作業セッション(pomodoro_events.session_id)ごとに、解いた問題数・
-- 正解数・難易度の自己申告、ノート/問題用紙の写真等を記録する。CBT(自動採点の問題テンプレート)
-- とは別系統で、外部教材を使った自己学習の記録を想定した軽量な仕組み。
CREATE TABLE public.pomodoro_study_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_uuid uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL, -- pomodoro_events.session_id(WORKセグメント)と対応
  problem_count integer,
  correct_count integer,
  difficulty smallint CHECK (difficulty BETWEEN 1 AND 5),
  note text,
  file_path text, -- Supabase Storage("study_logs"バケット、非公開)内のパス。閲覧時に署名URLを発行する
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.pomodoro_study_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own study logs" ON public.pomodoro_study_logs
  FOR SELECT USING (auth.uid() = student_uuid);
CREATE POLICY "Students can insert own study logs" ON public.pomodoro_study_logs
  FOR INSERT WITH CHECK (auth.uid() = student_uuid);
CREATE POLICY "Students can update own study logs" ON public.pomodoro_study_logs
  FOR UPDATE USING (auth.uid() = student_uuid);
CREATE POLICY "Students can delete own study logs" ON public.pomodoro_study_logs
  FOR DELETE USING (auth.uid() = student_uuid);
CREATE POLICY "Admins can view all study logs" ON public.pomodoro_study_logs
  FOR SELECT USING (public.is_admin());
CREATE POLICY "Teachers can view own organization study logs" ON public.pomodoro_study_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles target
      WHERE target.id = pomodoro_study_logs.student_uuid
      AND public.is_teacher_of(target.organization_id)
    )
  );

-- pomodoro_events/bug_reportsで既に一度踏んだ落とし穴(RLSはあってもGRANT漏れでanon/authenticated
-- から書き込めない)を繰り返さないよう、先にGRANTしておく。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pomodoro_study_logs TO anon, authenticated;

CREATE INDEX idx_pomodoro_study_logs_student ON public.pomodoro_study_logs(student_uuid, created_at DESC);
CREATE INDEX idx_pomodoro_study_logs_session ON public.pomodoro_study_logs(session_id);

-- ファイル保存用のStorageバケット。生徒のノート等の写真なので非公開にする。
INSERT INTO storage.buckets (id, name, public)
VALUES ('study_logs', 'study_logs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload study log files" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'study_logs');

CREATE POLICY "Users can delete own study log files" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'study_logs' AND auth.uid() = owner);
