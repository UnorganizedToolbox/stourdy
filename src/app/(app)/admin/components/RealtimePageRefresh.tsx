'use client'

import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeReload } from '@/lib/useRealtimeReload';

// テーブルが変わったらページを取り直す。タイマーのような、巻き込まれると困る部品が同じページに
// ない画面(教師・管理者向けの一覧など)専用。タイマーがあるページでは、その欄だけを取り直す方式
// (StudentQAPanel など)を使うこと。
export default function RealtimePageRefresh({ channel, table, filter }: { channel: string; table: string; filter?: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const reload = useCallback(async () => {
    startTransition(() => router.refresh());
  }, [router]);
  useRealtimeReload({ channel, table, filter, reload });
  return null;
}
