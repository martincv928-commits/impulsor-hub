import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { esError, supabase } from './supabase';
import { BRAND } from './brand';
import Logo from './Logo';
import Chat from './Chat';
import Config from './Config';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <Splash />;
  if (!session) return <Login />;
  return <Home />;
}

function Splash({ text = 'Cargando…' }: { text?: string }) {
  return <div className="splash"><Logo size={72} /><p className="muted">{text}</p></div>;
}

function Login() {
  const [email, setEmail] = useState(''); const [pass, setPass] = useState('');
  const [signup, setSignup] = useState(false); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setMsg(''); setBusy(true);
    const r = signup ? await supabase.auth.signUp({ email, password: pass }) : await supabase.auth.signInWithPassword({ email, password: pass });
    setBusy(false);
    if (r.error) setMsg(esError(r.error.message));
    else if (signup && !r.data.session) setMsg('Cuenta creada. Confirma tu correo con el enlace que te enviamos y luego inicia sesión.');
  }
  return (
    <main className="auth">
      <div className="brandblock"><Logo size={84} /><h1>{BRAND.name}</h1><p>{BRAND.tagline}</p></div>
      <form className="card" onSubmit={go}>
        <h2>{signup ? 'Crear cuenta' : 'Iniciar sesión'}</h2>
        <label>Correo<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Contraseña<input type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={pass} onChange={(e) => setPass(e.target.value)} minLength={8} required /></label>
        <button disabled={busy}>{busy ? 'Un momento…' : signup ? 'Crear cuenta' : 'Entrar'}</button>
        <button type="button" className="link" onClick={() => { setSignup(!signup); setMsg(''); }}>{signup ? 'Ya tengo cuenta' : 'Crear una cuenta'}</button>
        {msg && <p className="note" role="alert">{msg}</p>}
      </form>
      <p className="muted foot">{BRAND.name} de {BRAND.by} · Sólo consulta: nunca modifica tu ERP.</p>
    </main>
  );
}

interface Tenant { id: string; name: string }
function Home() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [role, setRole] = useState<string>('');
  const [tab, setTab] = useState<'chat' | 'config'>('chat');
  const [err, setErr] = useState('');
  async function load() {
    const { data, error } = await supabase.from('tenants').select('id, name');
    if (error) return setErr(esError(error.message));
    setTenants(data);
    if (data?.[0]) {
      const { data: me } = await supabase.auth.getUser();
      const { data: m } = await supabase.from('members').select('role').eq('tenant_id', data[0].id).eq('user_id', me.user!.id).maybeSingle();
      setRole(m?.role ?? '');
    }
  }
  useEffect(() => { load(); }, []);
  if (err) return <div className="splash"><Logo size={56} /><p role="alert">{err}</p><button onClick={() => { setErr(''); load(); }}>Reintentar</button></div>;
  if (!tenants) return <Splash />;
  if (!tenants.length) return <Onboarding onDone={load} />;
  const t = tenants[0];
  return (
    <div className="shell">
      <header>
        <div className="hbrand"><Logo size={32} /><div><strong>{t.name}</strong><small>{BRAND.name}</small></div></div>
        <nav aria-label="Secciones">
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Asistente</button>
          {role === 'admin' && <button className={tab === 'config' ? 'on' : ''} onClick={() => setTab('config')}>Configuración</button>}
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Salir</button>
        </nav>
      </header>
      {tab === 'chat' && (role === 'admin' || role === 'gerente') && <Chat tenantId={t.id} isAdmin={role === 'admin'} goConfig={() => setTab('config')} />}
      {tab === 'chat' && role === 'lector' && <p className="center">Tu rol es "lector": no tienes acceso al asistente. Pide al administrador que te cambie a "gerente".</p>}
      {tab === 'config' && role === 'admin' && <Config tenantId={t.id} />}
    </div>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.rpc('create_tenant', { p_name: name });
    setBusy(false);
    if (error) setErr(esError(error.message)); else onDone();
  }
  return (
    <main className="auth">
      <div className="brandblock"><Logo size={72} /><h1>Bienvenido a {BRAND.name}</h1><p>Empecemos creando tu empresa.</p></div>
      <form className="card" onSubmit={create}>
        <label>Nombre de la empresa<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
        <button disabled={busy}>{busy ? 'Creando…' : 'Crear empresa'}</button>
        {err && <p className="note" role="alert">{err}</p>}
      </form>
      <p className="muted foot">Después podrás conectar tu ERP, escribir las reglas del asistente y poner el chat en tu sitio web.</p>
    </main>
  );
}
