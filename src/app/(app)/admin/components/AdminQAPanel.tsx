'use client'

import { useCallback, useState } from 'react';
import AdminQAManager, { type Question } from './AdminQAManager';
import { getAdminQuestions } from '../actions';
import { useRealtimeReload } from '@/lib/useRealtimeReload';

// 教師・管理者の質問箱。生徒からの質問・返信は Realtime で受け取り、この欄だけを取り直す。
// ページ全体を取り直さないので、入力途中の回答などが巻き込まれない。
export default function AdminQAPanel({ initialQuestions }: { initialQuestions: Question[] }) {
  const [questions, setQuestions] = useState(initialQuestions);

  const reload = useCallback(async () => {
    setQuestions((await getAdminQuestions()) as Question[]);
  }, []);

  useRealtimeReload({ channel: 'admin_questions', table: 'questions', reload });

  const openCount = questions.filter((q) => q.status === 'open').length;

  return (
    <>
      <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-amber-50/50 dark:bg-amber-900/10 flex justify-between items-center">
        <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
          Q&A管理
        </h3>
        <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 px-2 py-1 rounded-lg font-bold">
          未回答 {openCount} 件
        </span>
      </div>
      <AdminQAManager questions={questions} onChanged={reload} />
    </>
  );
}
