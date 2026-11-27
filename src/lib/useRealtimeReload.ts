'use client'

import { useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';

// テーブルの変更を Supabase Realtime で受け取り、呼び出し側の部品だけを取り直すためのフック。
// router.refresh() はページ全体を取り直すので、同じページのポモドーロタイマーなど無関係な部品まで
// 巻き込む。ここでは reload(呼び出し側が自分のデータだけをサーバーアクションで取り直す関数)だけを呼ぶ。
//
// - 変更が続けて届いても、取り直しは同時に1本だけにし、実行中に来た分は終わってから1回だけまとめて行う。
// - タブが背面にある間は接続が切れることがある(iPad の Safari で他のアプリを前面にしている間など)。
//   画面に戻ったときにも取り直して、取りこぼしを埋める。
// - 受け取れるのは RLS で読める行の変更だけなので、見えてはいけない行の通知は届かない。
export function useRealtimeReload(options: {
  channel: string;
  table: string;
  filter?: string;
  reload: () => Promise<void>;
}) {
  const { channel, table, filter } = options;
  const reloadRef = useRef(options.reload);
  useEffect(() => {
    reloadRef.current = options.reload;
  }, [options.reload]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
    if (!url || !key) return;

    let running = false;
    let queued = false;
    let disposed = false;
    const run = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        await reloadRef.current();
      } catch (e) {
        console.error(`Failed to reload after ${table} change`, e);
      } finally {
        running = false;
        if (queued && !disposed) {
          queued = false;
          void run();
        }
      }
    };

    const supabase = createBrowserClient(url, key);
    let ch: ReturnType<typeof supabase.channel> | null = null;

    // ログイン情報を読み込む前に購読すると、未ログイン(anon)として登録され、RLS で読める行が無いため
    // 通知が一切届かない(2026-11-27、生徒側で実際に起きた)。先にセッションを読み、そのトークンを
    // Realtime に渡してから購読する。
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (disposed) return;
      ch = supabase
        .channel(channel)
        .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => {
          void run();
        })
        .subscribe();
    })();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (ch) supabase.removeChannel(ch);
    };
  }, [channel, table, filter]);
}
