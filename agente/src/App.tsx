import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import Chat from './Chat';
import Config from './Config';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <p className="center">Cargando…</p>;
  if (!session) return <Login />;
  return <Home />;
}

function Login() {
  const [email, setEmail] = useState(''); const [pass, setPass] = useState('');
  const [signup, setSignup] = useState(false); const [msg, setMsg] = useState('');
  async function go(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    const r = signup ? await supabase.auth.signUp({ email, password: pass }) : await supabase.auth.signInWithPassword({ email, password: pass });
    if (r.error) setMsg(r.error.message);
    else if (signup && !r.data.session) setMsg('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.');
  }
  return (
    <form className="card narrow" onSubmit={go}>
      <h1>Agente</h1>
      <p className="muted">Tu asistente gerencial y de atención a clientes, conectado a tu ERP.</p>
      <input type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" placeholder="Contraseña (mín. 8)" value={pass} onChange={(e) => setPass(e.target.value)} minLength={8} required />
      <button>{signup ? 'Crear cuenta' : 'Entrar'}</button>
      <button type="button" className="link" onClick={() => setSignup(!signup)}>{signup ? 'Ya tengo cuenta' : 'Crear una cuenta'}</button>
      {msg && <p className="note">{msg}</p>}
    </form>
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
    if (error) return setErr(error.message);
    setTenants(data);
    if (data?.[0]) {
      const { data: me } = await supabase.auth.getUser();
      const { data: m } = await supabase.from('members').select('role').eq('tenant_id', data[0].id).eq('user_id', me.user!.id).maybeSingle();
      setRole(m?.role ?? '');
    }
  }
  useEffect(() => { load(); }, []);
  if (err) return <p className="center">{err}</p>;
  if (!tenants) return <p className="center">Cargando…</p>;
  if (!tenants.length) return <Onboarding onDone={load} />;
  const t = tenants[0];
  return (
    <div className="shell">
      <header><strong>{t.name}</strong>
        <nav>
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Asistente</button>
          {role === 'admin' && <button className={tab === 'config' ? 'on' : ''} onClick={() => setTab('config')}>Configuración</button>}
          <button onClick={() => supabase.auth.signOut()}>Salir</button>
        </nav>
      </header>
      {tab === 'chat' && (role === 'admin' || role === 'gerente') && <Chat tenantId={t.id} />}
      {tab === 'chat' && role === 'lector' && <p className="center">Tu rol es "lector": no tienes acceso al asistente.</p>}
      {tab === 'config' && role === 'admin' && <Config tenantId={t.id} />}
    </div>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(''); const [err, setErr] = useState('');
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('create_tenant', { p_name: name });
    if (error) setErr(error.message); else onDone();
  }
  return (
    <form className="card narrow" onSubmit={create}>
      <h2>Crea tu empresa</h2>
      <input placeholder="Nombre de la empresa" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      <button>Crear</button>
      {err && <p className="note">{err}</p>}
    </form>
  );
}
