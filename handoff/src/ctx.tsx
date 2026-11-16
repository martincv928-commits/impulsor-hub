import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Row } from './report';

export type Ctx = {
  uid: string; org: string; orgName: string; role: 'admin' | 'supervisor' | 'worker'; me: string;
  members: Row[]; reloadMembers: () => void; go: (screen: string, arg?: string) => void;
};
export const C = createContext<Ctx>(null as any);
export const useCtx = () => useContext(C);
export const isManager = (r: string) => r === 'admin' || r === 'supervisor';
export const nameOf = (members: Row[], id?: string | null) => members.find((m) => m.user_id === id)?.display_name ?? '—';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; err: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn().then((d) => live && (setData(d), setErr(''))).catch((e) => live && setErr(String(e?.message ?? e))).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, err, loading, reload: () => setN((x) => x + 1) };
}

export function Msg({ err, ok }: { err?: string; ok?: string }): ReactNode {
  return err ? <div className="err">{err}</div> : ok ? <div className="okmsg">{ok}</div> : null;
}
