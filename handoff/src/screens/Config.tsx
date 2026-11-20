import { useState } from 'react';
import { supabase } from '../supabase';
import { Msg, useCtx, useLoad } from '../ctx';
import { errText, rpc, sel } from '../lib';
import type { Row } from '../report';

const EVENTS: [string, string][] = [['handoff_submitted', 'Entrega enviada'], ['handoff_accepted', 'Entrega aceptada'], ['handoff_rejected', 'Entrega rechazada'], ['handoff_discrepancy', 'Discrepancia registrada'], ['critical_issue', 'Pendiente crítico'], ['handoff_unreceived', 'Entrega sin recibir (requiere programador, pendiente)'], ['shift_summary', 'Resumen de cierre (manual)']];
const HOOKS = ['handoff.created', 'handoff.submitted', 'handoff.accepted', 'handoff.disputed', 'handoff.rejected', 'issue.created', 'issue.assigned', 'issue.resolved'];

export default function Config({ arg }: { arg?: string }) {
  const [tab, setTab] = useState(arg ?? 'estructura');
  const tabs = [['estructura', 'Estructura'], ['equipo', 'Equipo'], ['plantillas', 'Plantillas'], ['destinatarios', 'Destinatarios'], ['integraciones', 'API']];
  return (
    <>
      <h2>Configuración</h2>
      <div className="chips">{tabs.map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'estructura' && <Estructura />}{tab === 'equipo' && <Equipo />}{tab === 'plantillas' && <Plantillas />}{tab === 'destinatarios' && <Destinatarios />}{tab === 'integraciones' && <Integraciones />}
    </>
  );
}

function useRun() {
  const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  return { err, ok, setOk, run: async (fn: () => Promise<unknown>, after?: () => void) => { setErr(''); try { await fn(); after?.(); } catch (e) { setErr(errText(e)); } } };
}

function Estructura() {
  const { org } = useCtx();
  const d = useLoad(async () => ({
    sites: await sel(supabase.from('sites').select('*').eq('org_id', org).order('created_at')),
    areas: await sel(supabase.from('areas').select('*').eq('org_id', org).order('created_at')),
    shifts: await sel(supabase.from('shift_definitions').select('*').eq('org_id', org).order('created_at')),
  }), [org]);
  const [site, setSite] = useState(''); const [area, setArea] = useState(''); const [areaSite, setAreaSite] = useState('');
  const [shift, setShift] = useState(''); const [t1, setT1] = useState('08:00'); const [t2, setT2] = useState('16:00');
  const r = useRun();
  const toggle = (table: string, row: Row) => r.run(async () => { const { error } = await supabase.from(table).update({ active: !row.active }).eq('id', row.id); if (error) throw error; }, d.reload);
  const ins = (table: string, row: Row, clear: () => void) => r.run(async () => { const { error } = await supabase.from(table).insert({ org_id: org, ...row }); if (error) throw error; }, () => { clear(); d.reload(); });
  if (!d.data) return <p className="mut">Cargando…</p>;
  const { sites, areas, shifts } = d.data;
  const Item = ({ table, row, extra }: { table: string; row: Row; extra?: string }) => <div className="item row"><span style={{ opacity: row.active ? 1 : .5 }}>{row.name}<span className="mut"> {extra}</span></span><button className="link" onClick={() => toggle(table, row)}>{row.active ? 'Desactivar' : 'Activar'}</button></div>;
  return (
    <>
      <Msg err={r.err} />
      <div className="card"><h3>Sedes</h3>{sites.map((s: Row) => <Item key={s.id} table="sites" row={s} />)}
        <input placeholder="Nueva sede" value={site} onChange={(e) => setSite(e.target.value)} /><button className="btn" disabled={!site.trim()} onClick={() => ins('sites', { name: site.trim() }, () => setSite(''))}>Agregar sede</button></div>
      <div className="card"><h3>Áreas</h3>{areas.map((a: Row) => <Item key={a.id} table="areas" row={a} extra={`· ${sites.find((s: Row) => s.id === a.site_id)?.name}`} />)}
        <select value={areaSite} onChange={(e) => setAreaSite(e.target.value)}><option value="">Sede…</option>{sites.map((s: Row) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input style={{ marginTop: 8 }} placeholder="Nueva área" value={area} onChange={(e) => setArea(e.target.value)} /><button className="btn" disabled={!area.trim() || !areaSite} onClick={() => ins('areas', { name: area.trim(), site_id: areaSite }, () => setArea(''))}>Agregar área</button></div>
      <div className="card"><h3>Turnos</h3>{shifts.map((s: Row) => <Item key={s.id} table="shift_definitions" row={s} extra={`· ${s.start_time?.slice(0, 5) ?? ''}–${s.end_time?.slice(0, 5) ?? ''}`} />)}
        <input placeholder="Nuevo turno (ej. Matutino)" value={shift} onChange={(e) => setShift(e.target.value)} />
        <div className="grid"><input type="time" value={t1} onChange={(e) => setT1(e.target.value)} /><input type="time" value={t2} onChange={(e) => setT2(e.target.value)} /></div>
        <button className="btn" disabled={!shift.trim()} onClick={() => ins('shift_definitions', { name: shift.trim(), start_time: t1, end_time: t2 }, () => setShift(''))}>Agregar turno</button></div>
    </>
  );
}

function Equipo() {
  const { org, uid, reloadMembers, orgName } = useCtx();
  const d = useLoad(() => sel(supabase.from('organization_members').select('*').eq('org_id', org).order('created_at')), [org]);
  const inv = useLoad(() => sel(supabase.from('org_invites').select('code,role,used_at,expires_at').eq('org_id', org).order('created_at', { ascending: false }).limit(10)), [org]);
  const [role, setRole] = useState('worker'); const r = useRun();
  async function share(code: string) {
    const text = `Te invito a ${orgName} en HANDOFF. Crea tu cuenta, toca «Unirme con código» y escribe: ${code}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); r.setOk('Invitación copiada.'); } } catch { /* cancelado */ }
  }
  const upd = (m: Row, patch: Row) => r.run(() => rpc('set_member', { p_org: org, p_user: m.user_id, p_role: patch.role ?? m.role, p_active: patch.active ?? m.active }), () => { d.reload(); reloadMembers(); });
  return (
    <>
      <Msg err={r.err} ok={r.ok} />
      <div className="card"><h3>Invitar trabajador</h3><p className="mut">Genera un código de un solo uso (vence en 7 días). La persona crea su cuenta y entra con «Unirme con código».</p>
        <select value={role} onChange={(e) => setRole(e.target.value)}><option value="worker">Trabajador</option><option value="supervisor">Supervisor / encargado</option><option value="admin">Administrador</option></select>
        <button className="btn" onClick={() => r.run(() => rpc('create_invite', { p_org: org, p_role: role }), inv.reload)}>Generar código</button>
        {(inv.data ?? []).map((i: Row) => <div className="item row" key={i.code}><span><b style={{ letterSpacing: 2, fontSize: 18 }}>{i.code}</b><div className="mut">{{ worker: 'Trabajador', supervisor: 'Supervisor', admin: 'Administrador' }[i.role as string]} · {i.used_at ? 'ya usado' : 'vigente hasta ' + new Date(i.expires_at).toLocaleDateString('es-MX')}</div></span>{!i.used_at && <button className="link" onClick={() => share(i.code)}>Compartir</button>}</div>)}</div>
      <div className="card"><h3>Miembros</h3>{(d.data ?? []).map((m: Row) => (
        <div className="item" key={m.user_id}><div className="row"><b>{m.display_name}{m.user_id === uid ? ' (tú)' : ''}</b><span className="mut">{m.active ? '' : 'inactivo'}</span></div>
          <div className="grid"><select value={m.role} onChange={(e) => upd(m, { role: e.target.value })}><option value="worker">Trabajador</option><option value="supervisor">Supervisor</option><option value="admin">Administrador</option></select>
            <button className="btn sec" style={{ margin: 0 }} onClick={() => upd(m, { active: !m.active })}>{m.active ? 'Desactivar' : 'Activar'}</button></div></div>))}</div>
    </>
  );
}

function Plantillas() {
  const { org } = useCtx();
  const d = useLoad(async () => ({ t: await sel(supabase.from('templates').select('*').eq('org_id', org).order('created_at')), f: await sel(supabase.from('template_fields').select('*').eq('org_id', org).order('position')) }), [org]);
  const [name, setName] = useState(''); const [open, setOpen] = useState(''); const r = useRun();
  const [nf, setNf] = useState({ label: '', type: 'text', required: false, options: '' });
  const upd = (table: string, id: string, patch: Row) => r.run(async () => { const { error } = await supabase.from(table).update(patch).eq('id', id); if (error) throw error; }, d.reload);
  if (!d.data) return <p className="mut">Cargando…</p>;
  const fields = d.data.f.filter((f: Row) => f.template_id === open);
  return (
    <>
      <Msg err={r.err} />
      <div className="card"><h3>Plantillas</h3>
        {d.data.t.map((t: Row) => <div className="item row" key={t.id}><span style={{ opacity: t.active ? 1 : .5 }}>{t.name}</span><span><button className="link" onClick={() => setOpen(open === t.id ? '' : t.id)}>{open === t.id ? 'Cerrar' : 'Editar campos'}</button> <button className="link" onClick={() => upd('templates', t.id, { active: !t.active })}>{t.active ? 'Desactivar' : 'Activar'}</button></span></div>)}
        <input placeholder="Nueva plantilla (vacía)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={() => r.run(async () => { const { error } = await supabase.from('templates').insert({ org_id: org, name: name.trim() }); if (error) throw error; }, () => { setName(''); d.reload(); })}>Crear plantilla</button></div>
      {open && <div className="card"><h3>Campos</h3>
        {fields.map((f: Row) => <div className="item row" key={f.id}><span style={{ opacity: f.active ? 1 : .5 }}>{f.position}. {f.label} <span className="mut">({f.type}{f.required ? ', obligatorio' : ''})</span></span>
          <span><button className="link" onClick={() => upd('template_fields', f.id, { required: !f.required })}>{f.required ? 'Opcional' : 'Obligatorio'}</button> <button className="link" onClick={() => upd('template_fields', f.id, { active: !f.active })}>{f.active ? 'Quitar' : 'Activar'}</button></span></div>)}
        <label>Nuevo campo<input value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} placeholder="Nombre" /></label>
        <select value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value })}>{[['text', 'Texto'], ['number', 'Número'], ['boolean', 'Sí/No'], ['select', 'Selección'], ['checklist', 'Checklist'], ['photo', 'Fotografía'], ['note', 'Observación'], ['signature', 'Firma simple (nombre)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {(nf.type === 'select' || nf.type === 'checklist') && <input style={{ marginTop: 8 }} placeholder="Opciones separadas por coma" value={nf.options} onChange={(e) => setNf({ ...nf, options: e.target.value })} />}
        <label><input type="checkbox" checked={nf.required} onChange={(e) => setNf({ ...nf, required: e.target.checked })} />Obligatorio</label>
        <button className="btn" disabled={!nf.label.trim()} onClick={() => r.run(async () => {
          const { error } = await supabase.from('template_fields').insert({ org_id: org, template_id: open, label: nf.label.trim(), type: nf.type, required: nf.required, position: fields.length + 1, options: nf.options.split(',').map((x) => x.trim()).filter(Boolean) });
          if (error) throw error;
        }, () => { setNf({ label: '', type: 'text', required: false, options: '' }); d.reload(); })}>Agregar campo</button>
        <p className="mut">Las entregas ya enviadas conservan su contenido original aunque cambies la plantilla.</p></div>}
    </>
  );
}

function Destinatarios() {
  const { org, members } = useCtx();
  const d = useLoad(async () => ({ r: await sel(supabase.from('report_recipients').select('*').eq('org_id', org)), s: await sel(supabase.from('sites').select('id,name').eq('org_id', org)), a: await sel(supabase.from('areas').select('id,name,site_id').eq('org_id', org)) }), [org]);
  const [f, setF] = useState({ user: '', event: 'handoff_submitted', site: '', area: '' }); const r = useRun();
  if (!d.data) return <p className="mut">Cargando…</p>;
  const nm = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? '—';
  return (
    <>
      <Msg err={r.err} />
      <div className="card"><h3>Destinatarios de notificaciones</h3>
        <p className="mut">Reciben notificación interna en la app. El correo automático no está activo (requiere proveedor configurado).</p>
        {d.data.r.map((x: Row) => <div className="item row" key={x.id}><span>{nm(x.user_id)} <span className="mut">· {EVENTS.find((e) => e[0] === x.event)?.[1]} · {x.site_id ? d.data!.s.find((s: Row) => s.id === x.site_id)?.name : 'toda la empresa'}{x.area_id ? ' / ' + d.data!.a.find((a: Row) => a.id === x.area_id)?.name : ''}</span></span>
          <button className="link" onClick={() => r.run(async () => { const { error } = await supabase.from('report_recipients').delete().eq('id', x.id); if (error) throw error; }, d.reload)}>Quitar</button></div>)}
        <label>Persona<select value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}><option value="">— elegir —</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label>
        <label>Evento<select value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })}>{EVENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Sede (opcional)<select value={f.site} onChange={(e) => setF({ ...f, site: e.target.value, area: '' })}><option value="">Toda la empresa</option>{d.data.s.map((s: Row) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {f.site && <label>Área (opcional)<select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}><option value="">Toda la sede</option>{d.data.a.filter((a: Row) => a.site_id === f.site).map((a: Row) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        <button className="btn" disabled={!f.user} onClick={() => r.run(async () => { const { error } = await supabase.from('report_recipients').insert({ org_id: org, user_id: f.user, event: f.event, site_id: f.site || null, area_id: f.area || null }); if (error) throw error; }, d.reload)}>Agregar destinatario</button></div>
    </>
  );
}

function Integraciones() {
  const { org } = useCtx();
  const keys = useLoad(() => sel(supabase.from('api_keys').select('id,name,prefix,created_at,revoked_at').eq('org_id', org).order('created_at', { ascending: false })), [org]);
  const hooks = useLoad(() => sel(supabase.from('webhook_subscriptions').select('id,url,events,active').eq('org_id', org)), [org]);
  const dels = useLoad(() => sel(supabase.from('webhook_deliveries').select('id,event_type,status,attempts,last_error,created_at').eq('org_id', org).order('created_at', { ascending: false }).limit(10)), [org]);
  const [kn, setKn] = useState(''); const [url, setUrl] = useState(''); const [ev, setEv] = useState<string[]>(['handoff.submitted']); const [secret, setSecret] = useState(''); const r = useRun();
  return (
    <>
      <Msg err={r.err} />
      {secret && <div className="okmsg">Cópialo ahora; no se volverá a mostrar:<br /><code style={{ wordBreak: 'break-all' }}>{secret}</code></div>}
      <div className="card"><h3>Claves de API (v1)</h3><p className="mut">Autenticación: <code>Authorization: Bearer hf_…</code>. Ver docs/API.md.</p>
        {(keys.data ?? []).map((k: Row) => <div className="item row" key={k.id}><span style={{ opacity: k.revoked_at ? .5 : 1 }}>{k.name} <span className="mut">{k.prefix}…</span></span>{!k.revoked_at && <button className="link" onClick={() => r.run(() => rpc('revoke_api_key', { p_id: k.id }), keys.reload)}>Revocar</button>}</div>)}
        <input placeholder="Nombre de la integración" value={kn} onChange={(e) => setKn(e.target.value)} />
        <button className="btn" disabled={!kn.trim()} onClick={() => r.run(async () => setSecret(await rpc('create_api_key', { p_org: org, p_name: kn })), () => { setKn(''); keys.reload(); })}>Crear clave</button></div>
      <div className="card"><h3>Webhooks</h3>
        {(hooks.data ?? []).map((h: Row) => <div className="item row" key={h.id}><span style={{ opacity: h.active ? 1 : .5, wordBreak: 'break-all' }}>{h.url}<div className="mut">{h.events.join(', ')}</div></span><button className="link" onClick={() => r.run(() => rpc('set_webhook_active', { p_id: h.id, p_active: !h.active }), hooks.reload)}>{h.active ? 'Pausar' : 'Activar'}</button></div>)}
        <input placeholder="https://tu-sistema.com/webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div style={{ margin: '8px 0' }}>{HOOKS.map((h) => <label key={h} style={{ fontWeight: 400, margin: '2px 0' }}><input type="checkbox" checked={ev.includes(h)} onChange={(e) => setEv(e.target.checked ? [...ev, h] : ev.filter((x) => x !== h))} />{h}</label>)}</div>
        <button className="btn" disabled={!url.startsWith('https://') || ev.length === 0} onClick={() => r.run(async () => setSecret((await rpc<Row>('create_webhook', { p_org: org, p_url: url, p_events: ev })).secret), () => { setUrl(''); hooks.reload(); })}>Crear webhook</button>
        <p className="mut">El envío real lo hace la función webhook-dispatch (requiere despliegue y programador: pendiente de configurar).</p></div>
      <div className="card"><h3>Últimas entregas de webhooks</h3>{(dels.data ?? []).length === 0 && <p className="mut">Sin eventos en cola.</p>}{(dels.data ?? []).map((x: Row) => <div className="item" key={x.id}>{x.event_type} · {x.status} · intentos {x.attempts}<div className="mut">{x.last_error}</div></div>)}</div>
    </>
  );
}
