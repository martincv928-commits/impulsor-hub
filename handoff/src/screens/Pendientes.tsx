import { useState } from 'react';
import { supabase } from '../supabase';
import { Ic } from '../brand';
import { Msg, isManager, nameOf, useCtx, useLoad } from '../ctx';
import { errText, rpc, sel, uploadPhoto, fdt } from '../lib';
import { ISSUE_STATUS, PRIORITY, type Row } from '../report';
import { Thumbs } from './Recibir';

const ACTION: Record<string, string> = { created: 'Creado', received: 'Recibido en entrega de turno', assigned: 'Asignado', responsibility_accepted: 'Asumió responsabilidad', status_changed: 'Cambio de estado', note: 'Nota', resolved: 'Resuelto', reopened: 'Reabierto' };

export default function Pendientes({ arg }: { arg?: string }) {
  const { org, go, members, uid } = useCtx();
  const [filter, setFilter] = useState<'open' | 'mine' | 'unassigned' | 'closed'>('open');
  const list = useLoad(() => sel(supabase.from('issues').select('id,title,priority,status,assignee,due_date,areas(name)').eq('org_id', org).order('created_at', { ascending: false }).limit(200)), [org, arg]);
  if (arg) return <IssueDetail id={arg} back={() => go('pendientes')} />;
  const openSt = ['open', 'in_progress', 'blocked'];
  const rows = (list.data ?? []).filter((i: Row) => filter === 'open' ? openSt.includes(i.status) : filter === 'mine' ? i.assignee === uid && openSt.includes(i.status) : filter === 'unassigned' ? !i.assignee && openSt.includes(i.status) : !openSt.includes(i.status));
  return (
    <>
      <h2>Pendientes</h2>
      <div className="chips">
        {([['open', 'Abiertos'], ['mine', 'Míos'], ['unassigned', 'Sin responsable'], ['closed', 'Cerrados']] as const).map(([k, l]) => <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <Msg err={list.err} />
      {rows.length === 0 && !list.loading && <div className="card empty"><div className="ico"><Ic n="check" size={26} /></div>Sin pendientes en esta vista.</div>}
      {rows.map((i: Row) => (
        <div className={`card tap s-${i.priority === 'critical' && i.status !== 'resolved' ? 'critical' : i.status}`} key={i.id} onClick={() => go('pendientes', i.id)}>
          <div className="row"><span className="title">{i.title}</span><span className={`badge b-${i.priority}`}>{PRIORITY[i.priority]}</span></div>
          <div className="mut"><span className={`badge b-${i.status}`}>{ISSUE_STATUS[i.status]}</span> {i.areas?.name} · {i.assignee ? nameOf(members, i.assignee) : 'SIN RESPONSABLE'}{i.due_date ? ` · vence ${i.due_date}` : ''}</div>
        </div>
      ))}
    </>
  );
}

function IssueDetail({ id, back }: { id: string; back: () => void }) {
  const { org, uid, role, members } = useCtx();
  const d = useLoad(async () => {
    const issue = (await sel<Row[]>(supabase.from('issues').select('*').eq('id', id)))[0];
    const [events, atts] = await Promise.all([
      sel(supabase.from('issue_events').select('*').eq('issue_id', id).order('created_at')),
      sel(supabase.from('attachments').select('id,path').eq('entity_type', 'issue').eq('entity_id', id)),
    ]);
    return { issue, events, atts };
  }, [id]);
  const [note, setNote] = useState(''); const [assignTo, setAssignTo] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (!d.data) return <><Msg err={d.err} /><button className="link back" onClick={back}><Ic n="back" size={18} />Volver</button></>;
  const { issue: i, events, atts } = d.data;
  const closed = i.status === 'resolved' || i.status === 'cancelled';
  const mgr = isManager(role);
  async function run(fn: () => Promise<unknown>, clear = true) {
    setBusy(true); setErr('');
    try { await fn(); if (clear) setNote(''); d.reload(); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  const status = (s: string) => run(() => rpc('set_issue_status', { p_issue: id, p_status: s, p_note: note || null }));
  const evText = (e: Row) => {
    const x = e.data ?? {};
    if (e.action === 'assigned') return `${x.from ? nameOf(members, x.from) : 'nadie'} → ${x.to ? nameOf(members, x.to) : 'nadie'}${x.note ? ' · ' + x.note : ''}`;
    if (e.action === 'responsibility_accepted') return x.from ? `antes: ${nameOf(members, x.from)}` : '';
    if (x.from && x.to) return `${ISSUE_STATUS[x.from]} → ${ISSUE_STATUS[x.to]}${x.note ? ' · ' + x.note : ''}`;
    return x.note ?? '';
  };
  return (
    <>
      <button className="link back" onClick={back}><Ic n="back" size={18} />Volver</button>
      <h2>{i.title}</h2>
      <p><span className={`badge b-${i.status}`}>{ISSUE_STATUS[i.status]}</span> <span className={`badge b-${i.priority}`}>{PRIORITY[i.priority]}</span> <span className="mut">{i.category}{i.external_ref ? ` · ref ${i.external_ref}` : ''}{i.due_date ? ` · vence ${i.due_date}` : ''}</span></p>
      <div className="card">{i.description || <span className="mut">Sin descripción.</span>}
        <p className="mut">Creado por {nameOf(members, i.created_by)} · Responsable actual: <b>{i.assignee ? nameOf(members, i.assignee) : 'SIN RESPONSABLE'}</b></p>
        {i.status === 'resolved' && <p className="okmsg">Resuelto por {nameOf(members, i.resolved_by)} · {fdt(i.resolved_at)}<br />{i.resolution_note}</p>}
        <Thumbs paths={atts.map((a: Row) => a.path)} />
      </div>
      {!closed && (
        <div className="card">
          <h3>Acciones</h3>
          {i.assignee !== uid && (!i.assignee || mgr) && <button className="btn" disabled={busy} onClick={() => run(() => rpc('accept_issue_responsibility', { p_issue: id }), false)}><Ic n="hand" size={20} />Asumir responsabilidad</button>}
          <label>Nota / justificación <small>(obligatoria para bloquear, resolver o cancelar)</small><textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="btn sec" disabled={busy || !note.trim()} onClick={() => run(() => rpc('add_issue_note', { p_issue: id, p_note: note }))}>Agregar nota</button>
          {(mgr || i.assignee === uid || !i.assignee) && <>
            <div className="grid">
              <button className="btn sec" disabled={busy || i.status === 'in_progress'} onClick={() => status('in_progress')}>En proceso</button>
              <button className="btn sec" disabled={busy || !note.trim()} onClick={() => status('blocked')}>Bloqueado</button>
            </div>
            <button className="btn ok" disabled={busy || !note.trim()} onClick={() => status('resolved')}><Ic n="check" size={20} />Marcar RESUELTO</button>
            <button className="btn bad" disabled={busy || !note.trim()} onClick={() => status('cancelled')}>Cancelar pendiente</button></>}
          {(mgr || i.assignee === uid) && <><label>Reasignar a<select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}><option value="">— elegir —</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label>
            <button className="btn sec" disabled={busy || !assignTo} onClick={() => run(() => rpc('assign_issue', { p_issue: id, p_user: assignTo, p_note: note || null }))}>Reasignar</button></>}
          <label className="btn sec"><Ic n="camera" size={20} />Adjuntar evidencia
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => uploadPhoto(f, org, 'issue', id), false); e.target.value = ''; }} /></label>
        </div>
      )}
      {closed && mgr && <button className="btn sec" disabled={busy} onClick={() => status('open')}>Reabrir</button>}
      <Msg err={err} />
      <h3>Cadena de responsabilidad</h3>
      <div className="card">
        {events.map((e: Row) => <div className={`tl t-${e.action}`} key={e.id}><b>{ACTION[e.action]}</b> · {nameOf(members, e.actor)}<div className="mut">{fdt(e.created_at)} {evText(e)}</div></div>)}
      </div>
    </>
  );
}
