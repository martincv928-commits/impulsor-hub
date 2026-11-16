import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { Ic } from '../brand';
import { Msg, nameOf, useCtx, useLoad } from '../ctx';
import { errText, rpc, sel, today, uploadPhoto, uuid } from '../lib';
import { Thumbs } from './Recibir';
import type { Row } from '../report';

export default function Entregar() {
  const { org, uid } = useCtx();
  const [active, setActive] = useState<string | null>(null);
  const drafts = useLoad(() => sel(supabase.from('handoffs').select('id,shift_date,areas(name),shift_definitions(name)').eq('org_id', org).eq('status', 'draft').eq('from_user', uid)), [org, uid, active]);
  if (active) return <Draft id={active} done={() => setActive(null)} />;
  return (
    <>
      <h2>Entregar turno</h2>
      {(drafts.data ?? []).length > 0 && (
        <div className="card"><h3>Mis borradores</h3>
          {drafts.data!.map((d: any) => <div className="item row" key={d.id}><span>{d.areas?.name} · {d.shift_definitions?.name} · {d.shift_date}</span><button className="link" onClick={() => setActive(d.id)}>Continuar</button></div>)}
        </div>
      )}
      <Setup onStart={setActive} />
    </>
  );
}

function Setup({ onStart }: { onStart: (id: string) => void }) {
  const { org, uid, members } = useCtx();
  const cfg = useLoad(async () => {
    const [sites, areas, shifts, templates] = await Promise.all([
      sel(supabase.from('sites').select('id,name').eq('org_id', org).eq('active', true)),
      sel(supabase.from('areas').select('id,name,site_id').eq('org_id', org).eq('active', true)),
      sel(supabase.from('shift_definitions').select('id,name').eq('org_id', org).eq('active', true)),
      sel(supabase.from('templates').select('id,name,site_id,area_id').eq('org_id', org).eq('active', true)),
    ]);
    return { sites, areas, shifts, templates };
  }, [org]);
  const [f, setF] = useState({ site: '', area: '', shift: '', tpl: '', date: today(), to: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (!cfg.data) return <><Msg err={cfg.err} /><p className="mut">Cargando…</p></>;
  const { sites, areas, shifts, templates } = cfg.data;
  const areaOpts = areas.filter((a: Row) => a.site_id === f.site);
  const tplOpts = templates.filter((t: Row) => (!t.site_id || t.site_id === f.site) && (!t.area_id || t.area_id === f.area));
  async function start() {
    setBusy(true); setErr('');
    try {
      const id = uuid();
      await rpc('save_handoff_draft', { p_id: id, p_org: org, p_site: f.site, p_area: f.area, p_shift: f.shift, p_template: f.tpl, p_date: f.date, p_to_user: f.to || null, p_responses: null });
      onStart(id);
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  const sel1 = (k: keyof typeof f, label: string, opts: Row[]) => (
    <label>{label}<select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value, ...(k === 'site' ? { area: '', tpl: '' } : {}) })}><option value="">— elegir —</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
  );
  return (
    <div className="card">
      <h3>Nueva entrega</h3>
      {sites.length === 0 && <div className="err">Aún no hay sedes/áreas/turnos. Pide al administrador configurarlos.</div>}
      {sel1('site', 'Sede', sites)}{sel1('area', 'Área', areaOpts)}{sel1('shift', 'Turno', shifts)}{sel1('tpl', 'Plantilla', tplOpts)}
      <label>Fecha<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label>Receptor <small>(opcional; si no eliges, cualquiera del equipo puede recibir)</small>
        <select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">Cualquiera del equipo</option>{members.filter((m) => m.user_id !== uid).map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label>
      <Msg err={err} />
      <button className="btn" disabled={busy || !f.site || !f.area || !f.shift || !f.tpl || !f.date} onClick={start}>Comenzar entrega</button>
    </div>
  );
}

function Draft({ id, done }: { id: string; done: () => void }) {
  const { org, members } = useCtx();
  const data = useLoad(async () => {
    const h = (await sel<Row[]>(supabase.from('handoffs').select('*,areas(name),shift_definitions(name)').eq('id', id)))[0];
    const [fields, resp, issues, inherited, atts] = await Promise.all([
      sel(supabase.from('template_fields').select('*').eq('template_id', h.template_id).eq('active', true).order('position')),
      sel(supabase.from('handoff_responses').select('field_id,value').eq('handoff_id', id)),
      sel(supabase.from('issues').select('*').eq('origin_handoff_id', id).order('created_at')),
      sel(supabase.from('issues').select('id,title,priority,status,assignee').eq('org_id', org).eq('area_id', h.area_id).in('status', ['open', 'in_progress', 'blocked']).neq('origin_handoff_id', id)),
      sel(supabase.from('attachments').select('id,path').eq('entity_type', 'handoff').eq('entity_id', id)),
    ]);
    return { h, fields, resp, issues, inherited, atts };
  }, [id]);
  const [vals, setVals] = useState<Record<string, any> | null>(null);
  const [sync, setSync] = useState<'ok' | 'pending' | 'error'>('ok');
  const [err, setErr] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  const key = 'hf_resp_' + id;

  useEffect(() => {
    if (!data.data) return;
    const server = Object.fromEntries(data.data.resp.map((r: Row) => [r.field_id, r.value]));
    let local: Record<string, any> = {};
    try { local = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* vacío */ }
    setVals({ ...server, ...local }); // lo escrito localmente no se pierde por una desconexión
  }, [data.data?.h.id]); // eslint-disable-line

  if (!data.data || !vals) return <><Msg err={data.err} /><p className="mut">Cargando…</p></>;
  const { h, fields, issues, inherited, atts } = data.data;

  async function save(v: Record<string, any>) {
    try {
      await rpc('save_handoff_draft', { p_id: id, p_org: org, p_site: h.site_id, p_area: h.area_id, p_shift: h.shift_id, p_template: h.template_id, p_date: h.shift_date, p_to_user: h.to_user, p_responses: v });
      setSync('ok');
    } catch (e) { setSync('error'); setErr(errText(e)); throw e; }
  }
  function set(fid: string, value: any) {
    const next = { ...vals!, [fid]: value };
    setVals(next); localStorage.setItem(key, JSON.stringify(next)); setSync('pending');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(next).catch(() => {}), 900);
  }
  async function addPhoto(fid: string, file: File) {
    setErr('');
    try {
      const aid = await uploadPhoto(file, org, 'handoff', id);
      set(fid, [...((vals![fid] as string[]) ?? []), aid]); data.reload();
    } catch (e) { setErr(errText(e)); }
  }
  async function submit() {
    setBusy(true); setErr('');
    window.clearTimeout(timer.current);
    try {
      await save(vals!);
      await rpc('submit_handoff', { p_id: id });
      localStorage.removeItem(key); setSent(true);
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  if (sent) return <><h2>Turno entregado</h2><div className="okmsg">El servidor confirmó el envío. La entrega quedó registrada con huella e inmutable; el entrante ya puede recibirla.</div><button className="btn" onClick={done}>Listo</button></>;

  return (
    <>
      <h2>{h.areas?.name} · {h.shift_definitions?.name}</h2>
      <p className="mut">Fecha {h.shift_date} · Receptor: {h.to_user ? nameOf(members, h.to_user) : 'cualquiera del equipo'} · {sync === 'ok' ? 'Guardado en el servidor' : sync === 'pending' ? 'Guardando…' : 'NO guardado en el servidor (se conserva en este teléfono)'}</p>
      <div className="card">
        {fields.map((f: Row) => (
          <FieldInput key={f.id} f={f} v={vals[f.id]} set={(x) => set(f.id, x)} onPhoto={(file) => addPhoto(f.id, file)} atts={atts} />
        ))}
      </div>
      <h3>Pendientes e incidencias de este turno</h3>
      <div className="card">
        {issues.length === 0 && <p className="mut">Ninguno registrado.</p>}
        {issues.map((i: Row) => <div key={i.id} className="item">{i.title} <span className={`badge b-${i.priority}`}>{i.priority}</span></div>)}
        <IssueForm handoff={h} onAdded={data.reload} />
      </div>
      {inherited.length > 0 && <><h3>Pendientes heredados abiertos en el área ({inherited.length})</h3><div className="card">{inherited.map((i: Row) => <div key={i.id} className="item">{i.title} <span className="mut">· {i.assignee ? nameOf(members, i.assignee) : 'sin responsable'}</span></div>)}<p className="mut">Se incluirán en la entrega para que el entrante los vea.</p></div></>}
      <Msg err={err} />
      <button className="btn ok" disabled={busy || sync === 'pending'} onClick={submit}>ENTREGAR TURNO</button>
      <button className="btn sec" onClick={done}>Salir (el borrador se conserva)</button>
    </>
  );
}

function FieldInput({ f, v, set, onPhoto, atts }: { f: Row; v: any; set: (x: any) => void; onPhoto: (file: File) => void; atts: Row[] }) {
  const label = <label>{f.label}{f.required && ' *'}{f.instructions && <small> — {f.instructions}</small>}</label>;
  switch (f.type) {
    case 'boolean':
      return <>{label}<div className="row" style={{ justifyContent: 'flex-start' }}>{[true, false].map((b) => <label key={String(b)} style={{ margin: '0 16px 0 0' }}><input type="radio" checked={v === b} onChange={() => set(b)} />{b ? 'Sí' : 'No'}</label>)}</div></>;
    case 'select':
      return <>{label}<select value={v ?? ''} onChange={(e) => set(e.target.value)}><option value="">— elegir —</option>{(f.options as string[]).map((o) => <option key={o}>{o}</option>)}</select></>;
    case 'checklist': {
      const cur = (v ?? {}) as Record<string, boolean>;
      return <>{label}{(f.options as string[]).map((o) => (
        <div key={o} className="row" style={{ justifyContent: 'flex-start', gap: 6 }}>
          <label style={{ margin: 0, fontWeight: 400 }}><input type="checkbox" checked={cur[o] === true} onChange={(e) => set({ ...Object.fromEntries((f.options as string[]).map((x) => [x, cur[x] ?? false])), [o]: e.target.checked })} />{o}</label>
        </div>))}</>;
    }
    case 'number':
      return <>{label}<input type="number" inputMode="decimal" value={v ?? ''} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} /></>;
    case 'note':
      return <>{label}<textarea value={v ?? ''} onChange={(e) => set(e.target.value)} /></>;
    case 'photo': {
      const mine = ((v as string[]) ?? []).map((id) => atts.find((a) => a.id === id)).filter(Boolean) as Row[];
      return <>{label}<Thumbs paths={mine.map((a) => a.path)} /><label className="btn sec"><Ic n="camera" size={20} />Tomar / agregar foto
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onPhoto(file); e.target.value = ''; }} /></label></>;
    }
    default:
      return <>{label}<input value={v ?? ''} onChange={(e) => set(e.target.value)} /></>;
  }
}

export function IssueForm({ handoff, onAdded }: { handoff: Row; onAdded: () => void }) {
  const { org, members } = useCtx();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', description: '', category: 'incidencia', priority: 'medium', due: '', assignee: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const nid = useRef(uuid());
  if (!open) return <button className="btn sec" onClick={() => setOpen(true)}><Ic n="plus" size={20} />Agregar pendiente / incidencia</button>;
  async function add() {
    setBusy(true); setErr('');
    try {
      await rpc('create_issue', { p_org: org, p_site: handoff.site_id, p_area: handoff.area_id, p_title: f.title, p_description: f.description || null, p_category: f.category, p_priority: f.priority, p_due: f.due || null, p_external_ref: null, p_handoff: handoff.id, p_assignee: f.assignee || null, p_id: nid.current });
      nid.current = uuid(); setF({ ...f, title: '', description: '' }); setOpen(false); onAdded();
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  return (
    <div>
      <label>Título<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label>Descripción<textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="grid">
        <label>Categoría<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['incidencia', 'pendiente', 'falla', 'pedido', 'seguridad', 'otro'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Prioridad<select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
      </div>
      <label>Fecha objetivo (opcional)<input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
      <label>Responsable (opcional)<select value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}><option value="">Sin responsable</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label>
      <Msg err={err} />
      <button className="btn" disabled={busy || !f.title.trim()} onClick={add}>Guardar pendiente</button>
      <button className="link" onClick={() => setOpen(false)}>Cancelar</button>
    </div>
  );
}
