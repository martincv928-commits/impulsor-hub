import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './supabase';
import { C, Msg, isManager, useCtx, useLoad, type Ctx } from './ctx';
import { errText, rpc, sel, fdt } from './lib';
import { Ic, Mark, Wordmark } from './brand';
import Entregar from './screens/Entregar';
import { Recibir, Historial } from './screens/Recibir';
import Pendientes from './screens/Pendientes';
import Supervisor from './screens/Supervisor';
import Config from './screens/Config';
import Inicio from './screens/Inicio';

function AuthFrame({ children, tagline }: { children: React.ReactNode; tagline: string }) {
  return (
    <div className="auth">
      <div className="brand"><Mark size={84} /><Wordmark size={24} /><p>{tagline}</p></div>
      <div className="sheet"><div className="in">{children}</div></div>
    </div>
  );
}

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
    <AuthFrame tagline="Cada turno se entrega. Cada pendiente tiene responsable.">
      <h2>{mode === 'in' ? 'Bienvenido de vuelta' : 'Crea tu cuenta'}</h2>
      <form onSubmit={submit}>
        <label>Correo<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="tu@empresa.com" /></label>
        <label>Contraseña <small>(mínimo 8 caracteres)</small><input type="password" required minLength={8} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
        <Msg err={err} ok={ok} />
        <button className="btn" disabled={busy}>{mode === 'in' ? 'Entrar' : 'Crear cuenta'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'No tengo cuenta · Crear una' : 'Ya tengo cuenta · Entrar'}</button>
      </form>
    </AuthFrame>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(''); const [company, setCompany] = useState(''); const [code, setCode] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) { setBusy(true); setErr(''); try { await fn(); onDone(); } catch (e) { setErr(errText(e)); } setBusy(false); }
  return (
    <AuthFrame tagline="Empieza registrando tu empresa o únete con un código de invitación.">
      <label>Tu nombre<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como te verá tu equipo" /></label>
      <div className="card" style={{ marginTop: 18 }}>
        <h3>Registrar una empresa</h3>
        <label style={{ marginTop: 0 }}>Nombre de la empresa<input value={company} onChange={(e) => setCompany(e.target.value)} /></label>
        <button className="btn" disabled={busy || company.trim().length < 2 || !name.trim()} onClick={() => run(() => rpc('create_organization', { p_name: company, p_display_name: name }))}>Crear empresa · seré administrador</button>
      </div>
      <div className="card">
        <h3>Unirme con código</h3>
        <label style={{ marginTop: 0 }}>Código de invitación<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: 3, fontWeight: 700 }} /></label>
        <button className="btn dark" disabled={busy || !code || !name.trim()} onClick={() => run(() => rpc('join_organization', { p_code: code, p_display_name: name }))}>Unirme</button>
      </div>
      <Msg err={err} />
      <button className="link" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
    </AuthFrame>
  );
}

const TABS: [string, string, string][] = [['inicio', 'home', 'Inicio'], ['recibir', 'inbox', 'Recibir'], ['entregar', 'send', 'Entregar'], ['pendientes', 'pin', 'Pendientes'], ['mas', 'menu', 'Más']];
const ROLE = { admin: 'Administrador', supervisor: 'Supervisor', worker: 'Trabajador' };

function Shell({ session }: { session: Session }) {
  const uid = session.user.id;
  const mem = useLoad(() => sel(supabase.from('organization_members').select('org_id,role,display_name,active,organizations(name)').eq('user_id', uid).eq('active', true)), [uid]);
  const [orgId] = useState(() => localStorage.getItem('hf_org') ?? '');
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
  const onTab = (k: string) => k === screen || (k === 'mas' && ['historial', 'supervisor', 'config'].includes(screen));
  return (
    <C.Provider value={ctx}>
      <header className="app">
        <Mark size={38} />
        <div className="who"><Wordmark size={15} /><small>{ctx.orgName} · {ctx.me}</small></div>
        <button className="iconbtn" aria-label="Notificaciones" onClick={() => ctx.go('mas')}><Ic n="bell" />{unread > 0 && <i>{unread}</i>}</button>
      </header>
      <main key={screen + (arg ?? '')}>{body}</main>
      <nav className="tabs">{TABS.map(([k, ic, l]) => (
        <button key={k} className={`${onTab(k) ? 'on' : ''} ${k === 'entregar' ? 'go' : ''}`} onClick={() => ctx.go(k)}>
          <span style={k === 'entregar' ? undefined : { display: 'grid' }}><Ic n={ic} size={k === 'entregar' ? 27 : 23} /></span>{l}
        </button>))}
      </nav>
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
  const rows: [string, string, string, string][] = [['historial', 'history', 'Historial de entregas', 'Todas las entregas y su recepción']];
  if (isManager(role)) rows.push(['supervisor', 'chart', 'Supervisor', 'Excepciones, resumen y reporte PDF']);
  if (role === 'admin') rows.push(['config', 'gear', 'Configuración', 'Sedes, equipo, plantillas, destinatarios y API']);
  return (
    <>
      <h2>Más</h2>
      <p className="mut" style={{ marginTop: -8 }}>Tu rol: <b>{ROLE[role]}</b></p>
      <div className="card menu">
        {rows.map(([k, ic, t, d]) => <div className="item tap" key={k} onClick={() => go(k)}><span className="ico"><Ic n={ic} /></span><div><b>{t}</b><span className="mut">{d}</span></div><Ic n="chevron" size={18} /></div>)}
      </div>
      <h3>Notificaciones</h3>
      <div className="card">
        {notes.length === 0 && <div className="empty"><div className="ico"><Ic n="bell" /></div>Sin notificaciones.</div>}
        {notes.map((n) => (
          <div className="item tap" key={n.id} onClick={() => open(n)}>
            <div className="row"><b style={{ fontWeight: n.read_at ? 600 : 800 }}>{n.title}</b>{!n.read_at && <span className="badge b-open">Nueva</span>}</div>
            <div className="mut">{n.body} · {fdt(n.created_at)}</div>
          </div>
        ))}
      </div>
      <button className="btn sec" onClick={() => supabase.auth.signOut()}><Ic n="logout" size={20} />Cerrar sesión</button>
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
  if (!configured) return <AuthFrame tagline="Falta configurar el backend."><div className="err">Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY al compilar. La app no simula datos.</div></AuthFrame>;
  if (session === undefined) return <AuthFrame tagline="Cargando…"><span /></AuthFrame>;
  return session ? <Shell session={session} /> : <Auth />;
}
