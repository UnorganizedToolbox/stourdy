'use client'

import { useCallback, useState } from 'react';
import QAThreadList, { type Question } from './QAThreadList';
import AskQuestionForm from './AskQuestionForm';
import { getMyQuestions } from '../actions';
import { useRealtimeReload } from '@/lib/useRealtimeReload';

// 生徒の質問箱。教師からの回答・返信は Realtime で受け取り、この欄だけを取り直す。
// ページ全体を取り直さないので、同じページのポモドーロタイマーには影響しない。
export default function StudentQAPanel({
  studentId,
  initialQuestions,
  questionsEnabled,
}: {
  studentId: string;
  initialQuestions: Question[];
  questionsEnabled: boolean;
}) {
  const [questions, setQuestions] = useState(initialQuestions);

  const reload = useCallback(async () => {
    setQuestions((await getMyQuestions()) as Question[]);
  }, []);

  useRealtimeReload({
    channel: `student_questions_${studentId}`,
    table: 'questions',
    filter: `student_uuid=eq.${studentId}`,
    reload,
  });

  const openCount = questions.filter((q) => q.status === 'open').length;

  return (
    <div className="card-glass flex-1 bg-white dark:bg-darkbg-secondary border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-sm h-full max-h-[calc(100vh-10rem)]">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex justify-between items-center">
        <h4 className="font-bold font-title text-contrast text-sm">質問箱 (Q&A)</h4>
        <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-1 rounded font-bold">
          {openCount}件 回答待ち
        </span>
      </div>

      <QAThreadList questions={questions} onChanged={reload} />

      <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-darkbg-secondary">
        {!questionsEnabled ? (
          <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-center">
            <p className="text-sm font-bold text-rose-600 dark:text-rose-400">
              <i className="fa-solid fa-circle-exclamation mr-1"></i>
              現在、質問の受付を一時停止しています。
            </p>
            <p className="text-xs text-rose-500/80 dark:text-rose-400/80 mt-1">教師の回答をお待ちいただくか、後ほどお試しください。</p>
          </div>
        ) : (
          <AskQuestionForm onAsked={reload} />
        )}
      </div>
    </div>
  );
}
