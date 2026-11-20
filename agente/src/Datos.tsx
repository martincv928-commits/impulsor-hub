import { useEffect, useState } from 'react';
import { api, supabase } from './supabase';
import { DATASETS, DATASET_KEYS, type DatasetKey } from '../supabase/functions/_shared/mapping';

type SrcType = 'odoo' | 'generic_rest' | 'files';
const TYPES: [SrcType, string, string][] = [
  ['odoo', 'Odoo', 'Conexión directa a tu Odoo.'],
  ['generic_rest', 'API de mi sistema', 'Cualquier sistema con API REST. Sólo lectura.'],
  ['files', 'Archivos Excel / CSV', 'Cargas reportes exportados de tu sistema.'],
];
const useMsg = () => { const [m, set] = useState(''); return [m, (x: string) => { set(x); setTimeout(() => set(''), 9000); }] as const; };

export default function Datos({ t }: { t: string }) {
  const [src, setSrc] = useState<any | null | undefined>(undefined);
  const [type, setType] = useState<SrcType>('odoo');
  const load = () => supabase.rpc('erp_source_public', { p_tenant: t }).then(({ data }) => { const r = data?.[0] ?? null; setSrc(r); if (r) setType(r.type); });
  useEffect(() => { load(); }, [t]);
  if (src === undefined) return null;
  const same = src?.type === type ? src : null;
  return (<>
    <section className="card"><h2>Fuente de datos</h2>
      <p className="muted">Elige de dónde lee AtalaIA la información de tu negocio. <strong>Sólo lee: nunca modifica nada.</strong> Cada empresa usa una fuente.</p>
      <div className="choices" role="radiogroup" aria-label="Tipo de fuente">
        {TYPES.map(([k, name, desc]) => (
          <button key={k} type="button" role="radio" aria-checked={type === k} className={'choice' + (type === k ? ' on' : '')} onClick={() => setType(k)}>
            <strong>{name}</strong><span>{desc}</span>{src?.type === k && <em className={'pill ' + src.status}>{src.status === 'ok' ? 'conectada' : src.status === 'error' ? 'con error' : 'sin probar'}</em>}
          </button>))}
      </div>
      {src && src.status === 'error' && src.last_error && src.type === type && <p className="note" role="alert">{src.last_error}</p>}
    </section>
    {type === 'odoo' && <OdooForm t={t} src={same} onSaved={load} />}
    {type === 'generic_rest' && <GenericForm t={t} src={same} onSaved={load} />}
    {type === 'files' && <FilesPanel t={t} active={src?.type === 'files'} onSaved={load} />}
  </>);
}

// ───────── Odoo ─────────
function OdooForm({ t, src, onSaved }: { t: string; src: any; onSaved: () => void }) {
  const [f, setF] = useState({ url: src?.config?.url ?? '', db: src?.config?.db ?? '', username: src?.config?.username ?? '', secret: '' });
  const [msg, say] = useMsg(); const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); say('Guardando y probando…');
    try { const r = await api<{ ok: boolean; detail: string }>({ action: 'source_save', tenant_id: t, type: 'odoo', config: { url: f.url, db: f.db, username: f.username }, secret: f.secret }); say((r.ok ? '✔ ' : '✖ ') + r.detail); setF({ ...f, secret: '' }); onSaved(); }
    catch (err) { say((err as Error).message); } setBusy(false);
  }
  return (<section className="card"><h2>Odoo · sólo lectura</h2>
    <p className="muted">Crea en Odoo un usuario con permisos de SÓLO LECTURA y una API key. La clave se guarda cifrada en el servidor y nunca se vuelve a mostrar.</p>
    <form onSubmit={save}>
      <label>URL de Odoo<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://miempresa.odoo.com" required /></label>
      <label>Base de datos<input value={f.db} onChange={(e) => setF({ ...f, db: e.target.value })} required /></label>
      <label>Usuario (correo)<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></label>
      <label>API key<input type="password" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} required={!src} placeholder={src ? 'En blanco = conservar la guardada' : ''} autoComplete="off" /></label>
      <button disabled={busy}>Guardar y probar conexión</button>{msg && <p className="note" role="status">{msg}</p>}
    </form></section>);
}

// ───────── API REST genérica ─────────
interface PG { type: string; page_param: string; size_param: string; size: string; offset_param: string; limit_param: string; cursor_param: string; next_path: string }
interface FRef { mode: 'path' | 'const'; value: string }
interface Q { on: boolean; path: string; items_path: string; pg: PG; date_from: string; date_to: string; fields: Record<string, FRef> }
const emptyQ = (ds: DatasetKey): Q => ({ on: false, path: '', items_path: '', date_from: '', date_to: '',
  pg: { type: 'none', page_param: 'page', size_param: 'per_page', size: '100', offset_param: 'offset', limit_param: 'limit', cursor_param: 'cursor', next_path: '' },
  fields: Object.fromEntries(DATASETS[ds].fields.map((f) => [f.key, { mode: 'path', value: '' } as FRef])) });
interface GS { base_url: string; auth_type: string; auth_name: string; auth_user: string; secret: string; decimal: string; date_format: string; ping_path: string; queries: Record<string, Q> }

function fromConfig(cfg: any): GS {
  const qs: Record<string, Q> = {}; for (const ds of DATASET_KEYS) qs[ds] = emptyQ(ds);
  for (const ds of DATASET_KEYS) {
    const c = cfg?.queries?.[ds]; if (!c) continue; const q = qs[ds];
    q.on = true; q.path = c.path ?? ''; q.items_path = c.items_path ?? ''; q.date_from = c.date_params?.from ?? ''; q.date_to = c.date_params?.to ?? '';
    if (c.pagination) q.pg = { ...q.pg, ...Object.fromEntries(Object.entries(c.pagination).map(([k, v]) => [k, String(v)])) } as PG;
    for (const [k, v] of Object.entries(c.fields ?? {})) q.fields[k] = typeof v === 'string' ? { mode: 'path', value: v } : { mode: 'const', value: (v as any).const };
  }
  return { base_url: cfg?.base_url ?? '', auth_type: cfg?.auth?.type ?? 'bearer', auth_name: cfg?.auth?.name ?? '', auth_user: cfg?.auth?.user ?? '', secret: '', decimal: cfg?.decimal ?? '.', date_format: cfg?.date_format ?? 'iso', ping_path: cfg?.ping_path ?? '', queries: qs };
}
function toConfig(s: GS) {
  const queries: Record<string, any> = {};
  for (const ds of DATASET_KEYS) {
    const q = s.queries[ds]; if (!q.on) continue;
    const c: any = { path: q.path.trim(), fields: {} };
    if (q.items_path.trim()) c.items_path = q.items_path.trim();
    if (ds === 'ventas' && q.date_from.trim() && q.date_to.trim()) c.date_params = { from: q.date_from.trim(), to: q.date_to.trim() };
    const p = q.pg; const n = (v: string) => (v.trim() ? Number(v) : undefined);
    if (p.type === 'page') c.pagination = { type: 'page', page_param: p.page_param, size_param: p.size_param || undefined, size: n(p.size) };
    else if (p.type === 'offset') c.pagination = { type: 'offset', offset_param: p.offset_param, limit_param: p.limit_param, size: n(p.size) };
    else if (p.type === 'cursor') c.pagination = { type: 'cursor', cursor_param: p.cursor_param, next_path: p.next_path };
    else if (p.type === 'link') c.pagination = { type: 'link', next_path: p.next_path };
    for (const [k, r] of Object.entries(q.fields)) if (r.value.trim()) c.fields[k] = r.mode === 'const' ? { const: r.value.trim() } : r.value.trim();
    queries[ds] = c;
  }
  const auth: any = { type: s.auth_type }; if (s.auth_type === 'header' || s.auth_type === 'query') auth.name = s.auth_name.trim(); if (s.auth_type === 'basic') auth.user = s.auth_user.trim();
  const cfg: any = { base_url: s.base_url.trim(), auth, decimal: s.decimal, date_format: s.date_format, queries };
  if (s.ping_path.trim()) cfg.ping_path = s.ping_path.trim();
  return cfg;
}

function GenericForm({ t, src, onSaved }: { t: string; src: any; onSaved: () => void }) {
  const [s, setS] = useState<GS>(() => fromConfig(src?.config)); const [msg, say] = useMsg(); const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState<Record<string, { ok: boolean; detail: string; rows?: Record<string, string>[] }>>({});
  const set = (p: Partial<GS>) => setS({ ...s, ...p });
  const setQ = (ds: DatasetKey, p: Partial<Q>) => setS({ ...s, queries: { ...s.queries, [ds]: { ...s.queries[ds], ...p } } });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); say('Guardando y probando…');
    try { const r = await api<{ ok: boolean; detail: string }>({ action: 'source_save', tenant_id: t, type: 'generic_rest', config: toConfig(s), secret: s.secret }); say((r.ok ? '✔ ' : '✖ ') + r.detail); set({ secret: '' }); onSaved(); }
    catch (err) { say((err as Error).message); } setBusy(false);
  }
  async function test(ds: DatasetKey) {
    setPrev({ ...prev, [ds]: { ok: false, detail: 'Probando…' } });
    try { const r = await api<any>({ action: 'generic_preview', tenant_id: t, dataset: ds, config: toConfig(s), secret: s.secret }); setPrev((p) => ({ ...p, [ds]: r })); }
    catch (err) { setPrev((p) => ({ ...p, [ds]: { ok: false, detail: (err as Error).message } })); }
  }
  return (<section className="card"><h2>API de mi sistema · sólo lectura</h2>
    <p className="muted">AtalaIA hará únicamente consultas de lectura (GET) a la API de tu sistema. Indica dónde está cada dato y pruébalo antes de guardar: ves cómo se leerían los primeros registros.</p>
    <form onSubmit={save}>
      <label>Dirección base de la API<input value={s.base_url} onChange={(e) => set({ base_url: e.target.value })} placeholder="https://api.miempresa.mx/v1" required /></label>
      <label>Autenticación<select value={s.auth_type} onChange={(e) => set({ auth_type: e.target.value })}>
        <option value="bearer">Token (Bearer)</option><option value="header">Llave en un encabezado</option><option value="query">Llave en la dirección (?llave=…)</option><option value="basic">Usuario y contraseña</option><option value="none">Sin autenticación</option></select></label>
      {(s.auth_type === 'header' || s.auth_type === 'query') && <label>{s.auth_type === 'header' ? 'Nombre del encabezado' : 'Nombre del parámetro'}<input value={s.auth_name} onChange={(e) => set({ auth_name: e.target.value })} placeholder={s.auth_type === 'header' ? 'X-Api-Key' : 'api_key'} required /></label>}
      {s.auth_type === 'basic' && <label>Usuario<input value={s.auth_user} onChange={(e) => set({ auth_user: e.target.value })} required /></label>}
      {s.auth_type !== 'none' && <label>{s.auth_type === 'basic' ? 'Contraseña' : 'Llave o token'}<input type="password" value={s.secret} onChange={(e) => set({ secret: e.target.value })} placeholder={src ? 'En blanco = conservar la guardada' : ''} autoComplete="off" /></label>}
      <div className="two">
        <label>Separador decimal<select value={s.decimal} onChange={(e) => set({ decimal: e.target.value })}><option value=".">Punto (1,234.50)</option><option value=",">Coma (1.234,50)</option></select></label>
        <label>Formato de fechas<select value={s.date_format} onChange={(e) => set({ date_format: e.target.value })}><option value="iso">AAAA-MM-DD</option><option value="dmy">DD/MM/AAAA</option><option value="mdy">MM/DD/AAAA</option></select></label>
      </div>
      <h3>¿Qué datos entrega tu API?</h3>
      {DATASET_KEYS.map((ds) => { const q = s.queries[ds]; const spec = DATASETS[ds]; const p = prev[ds];
        return (<details key={ds} className="ds" open={q.on}>
          <summary>{spec.label}{q.on ? ' ✓' : ''}</summary>
          <label className="row"><input type="checkbox" checked={q.on} onChange={(e) => setQ(ds, { on: e.target.checked })} /> Usar esta consulta</label>
          {q.on && <>
            <label>Ruta<input value={q.path} onChange={(e) => setQ(ds, { path: e.target.value })} placeholder="/ventas" required /></label>
            <label>Dónde está la lista en la respuesta <small>(vacío si la respuesta ya es una lista)</small><input value={q.items_path} onChange={(e) => setQ(ds, { items_path: e.target.value })} placeholder="data" /></label>
            {ds === 'ventas' && <div className="two"><label>Parámetro "desde" <small>(opcional)</small><input value={q.date_from} onChange={(e) => setQ(ds, { date_from: e.target.value })} placeholder="desde" /></label><label>Parámetro "hasta"<input value={q.date_to} onChange={(e) => setQ(ds, { date_to: e.target.value })} placeholder="hasta" /></label></div>}
            <label>Paginación<select value={q.pg.type} onChange={(e) => setQ(ds, { pg: { ...q.pg, type: e.target.value } })}>
              <option value="none">Una sola respuesta</option><option value="page">Por número de página</option><option value="offset">Por desplazamiento (offset)</option><option value="cursor">Por cursor</option><option value="link">Por enlace "siguiente"</option></select></label>
            {q.pg.type === 'page' && <div className="two"><label>Parámetro de página<input value={q.pg.page_param} onChange={(e) => setQ(ds, { pg: { ...q.pg, page_param: e.target.value } })} /></label><label>Parámetro de tamaño<input value={q.pg.size_param} onChange={(e) => setQ(ds, { pg: { ...q.pg, size_param: e.target.value } })} /></label><label>Tamaño<input inputMode="numeric" value={q.pg.size} onChange={(e) => setQ(ds, { pg: { ...q.pg, size: e.target.value } })} /></label></div>}
            {q.pg.type === 'offset' && <div className="two"><label>Parámetro offset<input value={q.pg.offset_param} onChange={(e) => setQ(ds, { pg: { ...q.pg, offset_param: e.target.value } })} /></label><label>Parámetro límite<input value={q.pg.limit_param} onChange={(e) => setQ(ds, { pg: { ...q.pg, limit_param: e.target.value } })} /></label><label>Tamaño<input inputMode="numeric" value={q.pg.size} onChange={(e) => setQ(ds, { pg: { ...q.pg, size: e.target.value } })} /></label></div>}
            {q.pg.type === 'cursor' && <div className="two"><label>Parámetro de cursor<input value={q.pg.cursor_param} onChange={(e) => setQ(ds, { pg: { ...q.pg, cursor_param: e.target.value } })} /></label><label>Dónde viene el siguiente cursor<input value={q.pg.next_path} onChange={(e) => setQ(ds, { pg: { ...q.pg, next_path: e.target.value } })} placeholder="meta.next" /></label></div>}
            {q.pg.type === 'link' && <label>Dónde viene el enlace siguiente<input value={q.pg.next_path} onChange={(e) => setQ(ds, { pg: { ...q.pg, next_path: e.target.value } })} placeholder="links.next" /></label>}
            <h3>Campos de cada registro</h3><p className="muted">Escribe el nombre del campo en la respuesta (ej. <code>cliente.nombre</code>).</p>
            {spec.fields.map((fld) => { const r = q.fields[fld.key]; const canConst = fld.kind === 'text' || fld.kind === 'currency';
              return (<label key={fld.key}>{fld.label}{fld.required ? ' *' : ''}
                <span className="inline"><input value={r.value} onChange={(e) => setQ(ds, { fields: { ...q.fields, [fld.key]: { ...r, value: e.target.value } } })} placeholder={r.mode === 'const' ? (fld.kind === 'currency' ? 'MXN' : 'valor fijo') : 'campo'} />
                  {canConst && <button type="button" className="ghost small" onClick={() => setQ(ds, { fields: { ...q.fields, [fld.key]: { ...r, mode: r.mode === 'const' ? 'path' : 'const' } } })}>{r.mode === 'const' ? 'Es fijo' : 'Campo'}</button>}</span></label>); })}
            <button type="button" className="ghost" onClick={() => test(ds)}>Probar esta consulta</button>
            {p && <div className={'preview ' + (p.ok ? 'ok' : 'bad')} role="status"><strong>{p.ok ? '✔' : '✖'}</strong> {p.detail}
              {p.rows && p.rows.length > 0 && <div className="tablewrap"><table><thead><tr>{Object.keys(p.rows[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead><tbody>{p.rows.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>}</div>}
          </>}
        </details>); })}
      <label>Ruta de prueba de conexión <small>(opcional)</small><input value={s.ping_path} onChange={(e) => set({ ping_path: e.target.value })} placeholder="/health" /></label>
      <button disabled={busy}>Guardar y probar conexión</button>{msg && <p className="note" role="status">{msg}</p>}
    </form></section>);
}

// ───────── Archivos ─────────
interface Flow { ds: DatasetKey; filename: string; base64: string; headers: string[]; sample: Record<string, string>[]; row_count: number; map: Record<string, { col: string; const: string }>; decimal: string; date_format: string; errors?: { row: number; message: string }[]; detail?: string; busy?: boolean }
const fileToBase64 = (file: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('No se pudo leer el archivo')); r.readAsDataURL(file); });

function FilesPanel({ t, active, onSaved }: { t: string; active: boolean; onSaved: () => void }) {
  const [vers, setVers] = useState<any[]>([]); const [flow, setFlow] = useState<Flow | null>(null); const [msg, say] = useMsg();
  const loadV = () => supabase.from('dataset_versions').select('dataset, filename, row_count, uploaded_at').eq('tenant_id', t).eq('active', true).then(({ data }) => setVers(data ?? []));
  useEffect(() => { loadV(); }, [t, active]);
  async function enable() { try { await api({ action: 'source_save', tenant_id: t, type: 'files', config: {} }); onSaved(); } catch (e) { say((e as Error).message); } }
  async function pick(ds: DatasetKey, file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) return say('El archivo es demasiado grande (máximo 5 MB).');
    say('Leyendo el archivo…');
    try {
      const base64 = await fileToBase64(file);
      const r = await api<any>({ action: 'dataset_preview', tenant_id: t, dataset: ds, filename: file.name, base64 });
      if (!r.ok) return say(r.detail);
      const map: Flow['map'] = {}; for (const f of DATASETS[ds].fields) map[f.key] = { col: r.suggested?.[f.key] ?? '', const: '' };
      setFlow({ ds, filename: file.name, base64, headers: r.headers, sample: r.sample, row_count: r.row_count, map, decimal: '.', date_format: 'iso' }); say('');
    } catch (e) { say((e as Error).message); }
  }
  async function commit() {
    if (!flow) return; setFlow({ ...flow, busy: true, errors: undefined, detail: undefined });
    const mapping: Record<string, unknown> = {}; for (const [k, v] of Object.entries(flow.map)) mapping[k] = v.col === '__const__' ? { const: v.const } : v.col || null;
    try {
      const r = await api<any>({ action: 'dataset_commit', tenant_id: t, dataset: flow.ds, filename: flow.filename, base64: flow.base64, mapping, decimal: flow.decimal, date_format: flow.date_format });
      if (r.ok) { say('✔ ' + r.detail); setFlow(null); loadV(); onSaved(); } else setFlow({ ...flow, busy: false, errors: r.errors, detail: r.detail });
    } catch (e) { setFlow({ ...flow, busy: false, detail: (e as Error).message }); }
  }
  async function remove(ds: DatasetKey) { try { await api({ action: 'dataset_remove', tenant_id: t, dataset: ds }); loadV(); onSaved(); } catch (e) { say((e as Error).message); } }

  if (!active) return (<section className="card"><h2>Archivos Excel / CSV</h2>
    <p className="muted">Exporta reportes de tu sistema (ventas, cobranza, inventario…) a Excel o CSV y cárgalos aquí. AtalaIA los valida fila por fila y responde con esos datos, indicando siempre la fecha de carga.</p>
    <button onClick={enable}>Usar archivos como fuente de datos</button>{msg && <p className="note">{msg}</p>}</section>);
  return (<>
    <section className="card"><h2>Archivos cargados</h2>
      <p className="muted">Los datos son los del último archivo cargado: no son en vivo. Para actualizarlos, vuelve a cargar el archivo. Si una fila tiene un error, no se carga nada: se te dice cuál y por qué.</p>
      {DATASET_KEYS.map((ds) => { const v = vers.find((x) => x.dataset === ds); return (
        <div key={ds} className="dsrow"><div><strong>{DATASETS[ds].label}</strong><div className="muted">{v ? `${v.filename} · ${Number(v.row_count).toLocaleString('es-MX')} filas · ${String(v.uploaded_at).slice(0, 10)}` : 'Sin archivo'}</div></div>
          <div className="actions"><label className="btn">{v ? 'Reemplazar' : 'Cargar'}<input type="file" accept=".csv,.txt,.xlsx" hidden onChange={(e) => { pick(ds, e.target.files?.[0]); e.target.value = ''; }} /></label>{v && <button className="ghost small" onClick={() => remove(ds)}>Quitar</button>}</div></div>); })}
      {msg && <p className="note" role="status">{msg}</p>}
    </section>
    {flow && <section className="card" aria-live="polite"><h2>{DATASETS[flow.ds].label}: revisa las columnas</h2>
      <p className="muted"><strong>{flow.filename}</strong> · {flow.row_count.toLocaleString('es-MX')} filas. Indica qué columna es cada dato.</p>
      {DATASETS[flow.ds].fields.map((fld) => { const m = flow.map[fld.key]; const canConst = fld.kind === 'text' || fld.kind === 'currency';
        return (<label key={fld.key}>{fld.label}{fld.required ? ' *' : ''}
          <select value={m.col} onChange={(e) => setFlow({ ...flow, map: { ...flow.map, [fld.key]: { ...m, col: e.target.value } } })}>
            <option value="">{fld.required ? '— elige una columna —' : '— no usar —'}</option>{flow.headers.map((h) => <option key={h} value={h}>{h}</option>)}{canConst && <option value="__const__">Valor fijo…</option>}</select>
          {m.col === '__const__' && <input value={m.const} onChange={(e) => setFlow({ ...flow, map: { ...flow.map, [fld.key]: { ...m, const: e.target.value } } })} placeholder={fld.kind === 'currency' ? 'MXN' : 'valor'} />}</label>); })}
      <div className="two"><label>Separador decimal<select value={flow.decimal} onChange={(e) => setFlow({ ...flow, decimal: e.target.value })}><option value=".">Punto (1,234.50)</option><option value=",">Coma (1.234,50)</option></select></label>
        <label>Formato de fechas<select value={flow.date_format} onChange={(e) => setFlow({ ...flow, date_format: e.target.value })}><option value="iso">AAAA-MM-DD</option><option value="dmy">DD/MM/AAAA</option><option value="mdy">MM/DD/AAAA</option></select></label></div>
      <h3>Así se ven las primeras filas</h3>
      <div className="tablewrap"><table><thead><tr>{flow.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{flow.sample.map((r, i) => <tr key={i}>{flow.headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody></table></div>
      {flow.detail && <p className="note" role="alert">{flow.detail}</p>}
      {flow.errors && <ul className="errs">{flow.errors.map((e, i) => <li key={i}>{e.row ? `Fila ${e.row}: ` : ''}{e.message}</li>)}</ul>}
      <div className="actions"><button onClick={commit} disabled={flow.busy}>{flow.busy ? 'Validando y cargando…' : 'Validar y cargar'}</button><button className="ghost" onClick={() => setFlow(null)} disabled={flow.busy}>Cancelar</button></div>
    </section>}
  </>);
}
