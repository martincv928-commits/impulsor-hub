import { useEffect, useState } from 'react';
import { API_URL, api, supabase } from './supabase';

type S = { company_name: string; company_profile: string; rules: string; forbidden_topics: string[]; tone: string; website_url: string; human_contact: string };
const PUBLIC_TOOLS = [['buscar_conocimiento', 'Responder con la información de la empresa y del sitio'], ['catalogo_productos', 'Mostrar el catálogo de productos publicados en Odoo (requiere módulo Sitio web)']] as const;

export default function Config({ tenantId }: { tenantId: string }) {
  return (<div className="config">
    <Empresa t={tenantId} /><Erp t={tenantId} /><Publico t={tenantId} /><Conocimiento t={tenantId} /><Sitio t={tenantId} /><WhatsApp t={tenantId} /><Equipo t={tenantId} />
  </div>);
}
const useMsg = () => { const [m, set] = useState(''); return [m, (x: string) => { set(x); setTimeout(() => set(''), 6000); }] as const; };

function Empresa({ t }: { t: string }) {
  const [s, setS] = useState<S | null>(null); const [msg, say] = useMsg();
  useEffect(() => { supabase.from('tenant_settings').select('*').eq('tenant_id', t).single().then(({ data }) => data && setS(data as S)); }, [t]);
  if (!s) return null;
  const f = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value });
  async function save() {
    const { error } = await supabase.from('tenant_settings').update({ ...s, updated_at: new Date().toISOString() }).eq('tenant_id', t);
    say(error ? error.message : 'Guardado');
  }
  return (<section className="card"><h2>Empresa y reglas</h2>
    <label>Nombre<input value={s.company_name} onChange={f('company_name')} /></label>
    <label>Perfil de la empresa (a qué se dedica, productos, horarios…)<textarea rows={4} value={s.company_profile} onChange={f('company_profile')} /></label>
    <label>Instrucciones: qué debe y qué NO debe hacer, cuidados especiales<textarea rows={4} value={s.rules} onChange={f('rules')} /></label>
    <label>Temas prohibidos (separados por coma). En modo cliente se bloquean automáticamente.<input value={s.forbidden_topics.join(', ')} onChange={(e) => setS({ ...s, forbidden_topics: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
    <label>Tono<input value={s.tone} onChange={f('tone')} /></label>
    <label>Sitio web<input value={s.website_url} onChange={f('website_url')} placeholder="https://…" /></label>
    <label>Contacto humano para derivar (correo / teléfono)<input value={s.human_contact} onChange={f('human_contact')} /></label>
    <button onClick={save}>Guardar</button>{msg && <span className="note">{msg}</span>}</section>);
}

function Erp({ t }: { t: string }) {
  const [st, setSt] = useState<any>(null); const [f, setF] = useState({ url: '', db: '', username: '', api_key: '' }); const [msg, say] = useMsg();
  const load = () => supabase.rpc('erp_connection_public', { p_tenant: t }).then(({ data }) => { const r = data?.[0]; setSt(r ?? null); if (r) setF((x) => ({ ...x, url: r.url, db: r.db, username: r.username })); });
  useEffect(() => { load(); }, [t]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); say('Guardando y probando…');
    try { const r = await api<{ ok: boolean; detail: string }>({ action: 'erp_save', tenant_id: t, ...f }); say((r.ok ? '✔ ' : '✖ ') + r.detail); setF({ ...f, api_key: '' }); load(); } catch (e) { say((e as Error).message); }
  }
  async function test() { try { const r = await api<{ ok: boolean; detail: string }>({ action: 'erp_test', tenant_id: t }); say((r.ok ? '✔ ' : '✖ ') + r.detail); load(); } catch (e) { say((e as Error).message); } }
  return (<section className="card"><h2>ERP (Odoo) · sólo lectura</h2>
    <p className="muted">Crea en Odoo un usuario con permisos de SÓLO LECTURA y una API key. La clave se guarda cifrada en el servidor y nunca se vuelve a mostrar.</p>
    {st && <p>Estado: <strong>{st.status}</strong>{st.last_error ? ` — ${st.last_error}` : ''}</p>}
    <form onSubmit={save}>
      <label>URL de Odoo<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://miempresa.odoo.com" required /></label>
      <label>Base de datos<input value={f.db} onChange={(e) => setF({ ...f, db: e.target.value })} required /></label>
      <label>Usuario (correo)<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></label>
      <label>API key<input type="password" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} required autoComplete="off" /></label>
      <button>Guardar y probar conexión</button>{st && <button type="button" onClick={test}>Probar de nuevo</button>}{msg && <span className="note">{msg}</span>}
    </form></section>);
}

function Publico({ t }: { t: string }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({}); const [msg, say] = useMsg();
  useEffect(() => { supabase.from('tools_exposed').select('tool, is_public').eq('tenant_id', t).then(({ data }) => setFlags(Object.fromEntries((data ?? []).map((r) => [r.tool, r.is_public])))); }, [t]);
  async function toggle(tool: string, v: boolean) {
    const { error } = await supabase.from('tools_exposed').upsert({ tenant_id: t, tool, is_public: v });
    if (error) return say(error.message); setFlags({ ...flags, [tool]: v });
  }
  return (<section className="card"><h2>Qué puede ver el público</h2>
    <p className="muted">El asistente del sitio web NUNCA accede a ventas, clientes, cobranza ni inventario. Sólo a lo que actives aquí.</p>
    {PUBLIC_TOOLS.map(([k, d]) => <label key={k} className="row"><input type="checkbox" checked={!!flags[k]} onChange={(e) => toggle(k, e.target.checked)} /> {d}</label>)}{msg && <span className="note">{msg}</span>}</section>);
}

function Conocimiento({ t }: { t: string }) {
  const [src, setSrc] = useState<any[]>([]); const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const [text, setText] = useState(''); const [msg, say] = useMsg();
  const load = () => supabase.from('knowledge_sources').select('id, kind, title, url, status, error').eq('tenant_id', t).order('created_at', { ascending: false }).then(({ data }) => setSrc(data ?? []));
  useEffect(() => { load(); }, [t]);
  async function add(kind: 'url' | 'text') {
    say('Procesando…');
    try { const r = await api<any>({ action: 'knowledge_add', tenant_id: t, kind, url, title, text }); say(r.ok ? `✔ ${r.chunks} fragmentos` : '✖ ' + r.detail); if (r.ok) { setUrl(''); setText(''); setTitle(''); } load(); } catch (e) { say((e as Error).message); }
  }
  return (<section className="card"><h2>Conocimiento (preguntas frecuentes, políticas, sitio)</h2>
    <label>Agregar página web<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.miempresa.mx/preguntas-frecuentes" /></label>
    <button onClick={() => add('url')} disabled={!url}>Importar página</button>
    <label>O pega texto<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ej. Horarios y envíos)" /><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
    <button onClick={() => add('text')} disabled={!text.trim()}>Guardar texto</button>{msg && <span className="note">{msg}</span>}
    <ul>{src.map((s) => <li key={s.id}>{s.title} <small>({s.status}{s.error ? `: ${s.error}` : ''})</small> <button className="link" onClick={async () => { await supabase.from('knowledge_sources').delete().eq('id', s.id); load(); }}>borrar</button></li>)}</ul></section>);
}

function Sitio({ t }: { t: string }) {
  const [ch, setCh] = useState<any>(null); const [origins, setOrigins] = useState(''); const [msg, say] = useMsg();
  useEffect(() => { supabase.from('channels').select('*').eq('tenant_id', t).eq('kind', 'web').single().then(({ data }) => { setCh(data); setOrigins((data?.allowed_origins ?? []).join('\n')); }); }, [t]);
  if (!ch) return null;
  async function save() {
    const list = origins.split(/[\s,]+/).map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
    if (list.some((o) => !/^https:\/\/[^/]+$/.test(o))) return say('Cada dominio debe ser como https://www.miempresa.mx (sin ruta)');
    const { error } = await supabase.from('channels').update({ allowed_origins: list, enabled: ch.enabled }).eq('id', ch.id); say(error ? error.message : 'Guardado');
  }
  const snippet = `<script src="${API_URL}/widget.js" data-token="${ch.public_token}"></script>`;
  return (<section className="card"><h2>Chat en tu sitio web</h2>
    <label>Dominios autorizados (uno por línea)<textarea rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://www.miempresa.mx" /></label>
    <label className="row"><input type="checkbox" checked={ch.enabled} onChange={(e) => setCh({ ...ch, enabled: e.target.checked })} /> Chat activo</label>
    <button onClick={save}>Guardar</button>{msg && <span className="note">{msg}</span>}
    <p className="muted">Pega este código antes de &lt;/body&gt; en tu sitio:</p><textarea readOnly rows={4} value={snippet} onFocus={(e) => e.target.select()} /></section>);
}

function Equipo({ t }: { t: string }) {
  const [list, setList] = useState<any[]>([]); const [email, setEmail] = useState(''); const [role, setRole] = useState('gerente'); const [msg, say] = useMsg();
  const load = () => supabase.rpc('list_members', { p_tenant: t }).then(({ data }) => setList(data ?? []));
  useEffect(() => { load(); }, [t]);
  async function add() { const { error } = await supabase.rpc('add_member_by_email', { p_tenant: t, p_email: email, p_role: role }); say(error ? error.message : 'Listo'); if (!error) { setEmail(''); load(); } }
  return (<section className="card"><h2>Equipo</h2>
    <ul>{list.map((m) => <li key={m.user_id}>{m.email} — {m.role}</li>)}</ul>
    <p className="muted">La persona debe crear primero su cuenta con ese correo.</p>
    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.mx" type="email" />
    <select value={role} onChange={(e) => setRole(e.target.value)}><option value="gerente">Gerente (usa el asistente)</option><option value="lector">Lector</option><option value="admin">Administrador</option></select>
    <button onClick={add} disabled={!email}>Agregar</button>{msg && <span className="note">{msg}</span>}</section>);
}

function WhatsApp({ t }: { t: string }) {
  const [acc, setAcc] = useState<{ phone_number_id: string; enabled: boolean } | null>(null);
  const [nums, setNums] = useState<{ phone: string; email: string }[]>([]);
  const [f, setF] = useState({ phone_number_id: '', access_token: '' });
  const [n, setN] = useState({ email: '', phone: '' }); const [msg, say] = useMsg();
  const load = () => {
    supabase.rpc('whatsapp_account_public', { p_tenant: t }).then(({ data }) => setAcc(data?.[0] ?? null));
    supabase.rpc('list_whatsapp_numbers', { p_tenant: t }).then(({ data }) => setNums(data ?? []));
  };
  useEffect(() => { load(); }, [t]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api({ action: 'wa_save', tenant_id: t, ...f }); say('Guardado'); setF({ ...f, access_token: '' }); load(); } catch (e) { say((e as Error).message); }
  }
  async function add() { const { error } = await supabase.rpc('add_whatsapp_number', { p_tenant: t, p_email: n.email, p_phone: n.phone }); say(error ? error.message : 'Listo'); if (!error) { setN({ email: '', phone: '' }); load(); } }
  return (<section className="card"><h2>WhatsApp (modo Gerente)</h2>
    <p className="muted">Requiere una cuenta de WhatsApp Business (Cloud API de Meta). Sólo los números autorizados abajo pueden consultar; a los demás no se les responde.</p>
    <p className="muted">URL del webhook para Meta: <code>{API_URL}/whatsapp</code></p>
    {acc && <p>Número conectado (ID): <strong>{acc.phone_number_id}</strong></p>}
    <form onSubmit={save}>
      <label>ID del número de teléfono (Meta)<input value={f.phone_number_id} onChange={(e) => setF({ ...f, phone_number_id: e.target.value })} required /></label>
      <label>Token de acceso permanente<input type="password" value={f.access_token} onChange={(e) => setF({ ...f, access_token: e.target.value })} required autoComplete="off" /></label>
      <button>Guardar</button>
    </form>
    <h3>Números autorizados</h3>
    <ul>{nums.map((x) => <li key={x.phone}>+{x.phone} — {x.email} <button className="link" onClick={async () => { await supabase.rpc('remove_whatsapp_number', { p_tenant: t, p_phone: x.phone }); load(); }}>quitar</button></li>)}</ul>
    <input type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} placeholder="correo del gerente/admin" />
    <input value={n.phone} onChange={(e) => setN({ ...n, phone: e.target.value })} placeholder="Número con código de país, ej. 5215512345678" />
    <button onClick={add} disabled={!n.email || !n.phone}>Autorizar número</button>{msg && <span className="note">{msg}</span>}</section>);
}
