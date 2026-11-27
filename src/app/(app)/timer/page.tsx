import { signQaImages } from "@/lib/qaImages";
export const dynamic = "force-dynamic";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import PomodoroTimer from "./components/PomodoroTimer";
import StudentQAPanel from "./components/StudentQAPanel";
import { resolveEffectiveRules, type RuleMap, type OrgRuleMap } from "@/lib/rules";

export default async function TimerPage() {
  const supabase = await createClient();

  // configLogsはuser情報に依存しないので認証確認と並列に取得する
  const [{ data: configLogs }, { data: { user } }] = await Promise.all([
    supabase
      .from('student_activity_logs')
      .select('metadata')
      .eq('activity_type', 'SYSTEM_CONFIG')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase.auth.getUser(),
  ]);

  const globalQuestionsEnabled = !(configLogs && configLogs.length > 0 && configLogs[0].metadata && (configLogs[0].metadata as any).questions_enabled === false);

  if (!user) {
    redirect('/login');
  }

  // プロフィールと所属団体のルールを1回の問い合わせで取得する(直列2回→1回)
  const { data: profile } = await supabase
    .from('profiles')
    .select('grade_level, role, organization_id, rule_overrides, pomodoro_experiment_enabled, organizations:organization_id (rules)')
    .eq('id', user.id)
    .single();
  const isTeacher = profile?.role === 'teacher';
  const experimentEnabled = profile?.pomodoro_experiment_enabled ?? false;

  const orgRules: OrgRuleMap = (profile?.organizations as unknown as { rules: OrgRuleMap } | null)?.rules || {};
  const effectiveRules = resolveEffectiveRules(orgRules, profile?.rule_overrides as RuleMap);
  const questionsEnabled = globalQuestionsEnabled && !effectiveRules.disable_questions;

  // 教師には質問箱(生徒→教師の連絡手段)は不要なので、ポモドーロのみ表示する
  if (isTeacher) {
    return (
      <section className="flex-1 flex flex-col gap-6 max-w-[700px] mx-auto w-full px-6 pt-2 pb-6">
        <PomodoroTimer gradeLevel={null} experimentEnabled={experimentEnabled} />
      </section>
    );
  }

  // Fetch open questions for this user
  const { data: questions } = await supabase
    .from('questions')
    .select('*')
    .eq('student_uuid', user.id)
    .order('created_at', { ascending: false });

  return (
    <section className="flex-1 flex flex-col gap-6 max-w-[1400px] mx-auto w-full px-6 pt-2 pb-6">
      <div className="flex-1 grid grid-cols-12 gap-6 h-[calc(100vh-10rem)] min-h-[600px]">
        {/* Left Column (Timer & Current task) */}
        <div className="col-span-12 lg:col-span-7 flex flex-col gap-6">
          <PomodoroTimer gradeLevel={profile?.grade_level ?? null} experimentEnabled={experimentEnabled} />
        </div>

        {/* Right Column (Q&A) */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">
          <StudentQAPanel
            studentId={user.id}
            initialQuestions={await signQaImages(questions || [])}
            questionsEnabled={questionsEnabled}
          />
        </div>
      </div>
    </section>
  );
}
