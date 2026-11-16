import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './supabase';
import { C, Msg, isManager, useCtx, useLoad, type Ctx } from './ctx';
import { errText, rpc, sel } from './lib';
import Entregar from './screens/Entregar';
import { Recibir, Historial } from './screens/Recibir';
import Pendientes from './screens/Pendientes';
import Supervisor from './screens/Supervisor';
import Config from './screens/Config';
import Inicio from './screens/Inicio';

function Auth() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState(''); const [pass, setPass] = useState('');
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('');
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password: pass });
        if (error) throw error;
        if (!data.session) setOk('Cuenta creada. Revisa tu correo para confirmarla y luego entra.');
      }
    } catch (x: any) { setErr(x.message?.includes('Invalid login') ? 'Correo o contraseña incorrectos.' : errText(x)); }
    setBusy(false);
  }
  return (
    <main>
      <h2 style={{ marginTop: 40 }}>HANDOFF</h2>
      <p className="mut">Cada turno se entrega. Cada pendiente tiene responsable.</p>
      <form className="card" onSubmit={submit}>
        <label>Correo<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label>Contraseña<input type="password" required minLength={8} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
        <Msg err={err} ok={ok} />
        <button className="btn" disabled={busy}>{mode === 'in' ? 'Entrar' : 'Crear cuenta'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'Crear cuenta nueva' : 'Ya tengo cuenta'}</button>
      </form>
    </main>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(''); const [company, setCompany] = useState(''); const [code, setCode] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) { setBusy(true); setErr(''); try { await fn(); onDone(); } catch (e) { setErr(errText(e)); } setBusy(false); }
  return (
    <main>
      <h2>Bienvenido</h2>
      <div className="card">
        <h3>Registrar una empresa</h3>
        <label>Nombre de la empresa<input value={company} onChange={(e) => setCompany(e.target.value)} /></label>
        <label>Tu nombre<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn" disabled={busy || company.trim().length < 2 || !name.trim()} onClick={() => run(() => rpc('create_organization', { p_name: company, p_display_name: name }))}>Crear empresa (serás administrador)</button>
      </div>
      <div className="card">
        <h3>Unirme con código de invitación</h3>
        <label>Código<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
        <label>Tu nombre<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn sec" disabled={busy || !code || !name.trim()} onClick={() => run(() => rpc('join_organization', { p_code: code, p_display_name: name }))}>Unirme</button>
      </div>
      <Msg err={err} />
      <button className="link" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
    </main>
  );
}

const TABS: [string, string, string][] = [['inicio', '🏠', 'Inicio'], ['entregar', '📤', 'Entregar'], ['recibir', '📥', 'Recibir'], ['pendientes', '📌', 'Pendientes'], ['mas', '☰', 'Más']];

function Shell({ session }: { session: Session }) {
  const uid = session.user.id;
  const mem = useLoad(() => sel(supabase.from('organization_members').select('org_id,role,display_name,active,organizations(name)').eq('user_id', uid).eq('active', true)), [uid]);
  const [orgId, setOrgId] = useState(() => localStorage.getItem('hf_org') ?? '');
  const [screen, setScreen] = useState('inicio'); const [arg, setArg] = useState<string | undefined>();
  const my = mem.data?.find((m: any) => m.org_id === orgId) ?? mem.data?.[0];
  const members = useLoad(() => (my ? sel(supabase.from('organization_members').select('user_id,display_name,role,active').eq('org_id', my.org_id)) : Promise.resolve([])), [my?.org_id]);
  const notes = useLoad(() => (my ? sel(supabase.from('notifications').select('id,title,body,entity_type,entity_id,read_at,created_at').eq('org_id', my.org_id).order('created_at', { ascending: false }).limit(30)) : Promise.resolve([])), [my?.org_id, screen]);
  useEffect(() => { if (my) localStorage.setItem('hf_org', my.org_id); }, [my?.org_id]);

  if (mem.loading) return <main><p className="mut">Cargando…</p></main>;
  if (mem.err) return <main><Msg err={mem.err} /><button className="btn" onClick={mem.reload}>Reintentar</button></main>;
  if (!my) return <Onboarding onDone={mem.reload} />;

  const ctx: Ctx = {
    uid, org: my.org_id, orgName: my.organizations?.name ?? '', role: my.role, me: my.display_name,
    members: (members.data ?? []).filter((m: any) => m.active), reloadMembers: members.reload,
    go: (s, a) => { setScreen(s); setArg(a); window.scrollTo(0, 0); },
  };
  const unread = (notes.data ?? []).filter((n: any) => !n.read_at).length;
  const body = {
    inicio: <Inicio />, entregar: <Entregar />, recibir: <Recibir arg={arg} />, pendientes: <Pendientes arg={arg} />,
    historial: <Historial arg={arg} />, supervisor: <Supervisor />, config: <Config />,
    mas: <Mas notes={notes.data ?? []} reload={notes.reload} />,
  }[screen];
  return (
    <C.Provider value={ctx}>
      <header>
        <div><b>HANDOFF</b><small>{ctx.orgName} · {ctx.me} ({ctx.role === 'admin' ? 'Administrador' : ctx.role === 'supervisor' ? 'Supervisor' : 'Trabajador'})</small></div>
        <button className="link" style={{ color: '#fff' }} onClick={() => ctx.go('mas')}>🔔 {unread || ''}</button>
      </header>
      <main key={screen + (arg ?? '')}>{body}</main>
      <nav className="tabs">{TABS.map(([k, ic, l]) => <button key={k} className={screen === k || (k === 'mas' && ['historial', 'supervisor', 'config'].includes(screen)) ? 'on' : ''} onClick={() => ctx.go(k)}><span>{ic}</span>{l}</button>)}</nav>
    </C.Provider>
  );
}

function Mas({ notes, reload }: { notes: any[]; reload: () => void }) {
  const { go, role } = useCtx();
  async function open(n: any) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
    reload();
    if (n.entity_type === 'handoffs') go(n.title.includes('por recibir') ? 'recibir' : 'historial', n.entity_id);
    if (n.entity_type === 'issues') go('pendientes', n.entity_id);
  }
  return (
    <>
      <h2>Más</h2>
      <button className="btn sec" onClick={() => go('historial')}>🗂️ Historial de entregas</button>
      {isManager(role) && <button className="btn sec" onClick={() => go('supervisor')}>📊 Supervisor</button>}
      {role === 'admin' && <button className="btn sec" onClick={() => go('config')}>⚙️ Configuración</button>}
      <h3>Notificaciones internas</h3>
      <div className="card">
        {notes.length === 0 && <p className="mut">Sin notificaciones.</p>}
        {notes.map((n) => (
          <div className="item" key={n.id} onClick={() => open(n)} style={{ cursor: 'pointer', fontWeight: n.read_at ? 400 : 700 }}>
            {n.title}<div className="mut">{n.body} · {new Date(n.created_at).toLocaleString('es-MX')}</div>
          </div>
        ))}
      </div>
      <button className="btn sec" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
    </>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!configured) return <main><h2>HANDOFF</h2><div className="err">Falta configurar el backend: define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY al compilar. La app no simula datos.</div></main>;
  if (session === undefined) return <main><p className="mut">Cargando…</p></main>;
  return session ? <Shell session={session} /> : <Auth />;
}
