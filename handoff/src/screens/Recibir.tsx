import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Ic } from '../brand';
import { Msg, isManager, nameOf, useCtx, useLoad } from '../ctx';
import { errText, pdfFromLines, rpc, sel, sharePdf, signedUrl, fdt } from '../lib';
import { handoffLines, fieldValueText, ISSUE_STATUS, PRIORITY, STATUS_LABEL, type Row } from '../report';

export function Thumbs({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => { Promise.all(paths.map(signedUrl)).then((u) => setUrls(u.filter(Boolean) as string[])); }, [paths.join('|')]); // eslint-disable-line
  return <div className="thumbs">{urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="evidencia" /></a>)}</div>;
}

export function Recibir({ arg }: { arg?: string }) {
  const { org, uid, role, go, members } = useCtx();
  const list = useLoad(() => sel(supabase.from('handoffs').select('id,from_user,to_user,shift_date,submitted_at,areas(name),shift_definitions(name)').eq('org_id', org).eq('status', 'pending_receipt').order('submitted_at')), [org]);
  if (arg) return <HandoffDetail id={arg} back={() => go('recibir')} receiving />;
  const rows = (list.data ?? []).filter((h: Row) => h.from_user !== uid && (!h.to_user || h.to_user === uid || isManager(role)));
  return (
    <>
      <h2>Turnos por recibir</h2>
      <Msg err={list.err} />
      {rows.length === 0 && !list.loading && <div className="card empty"><div className="ico"><Ic n="inbox" size={26} /></div>No hay entregas pendientes de recibir para ti.</div>}
      {rows.map((h: Row) => (
        <div className="card tap s-pending_receipt" key={h.id} onClick={() => go('recibir', h.id)}>
          <div className="row"><span className="title">{h.areas?.name} · {h.shift_definitions?.name}</span><span className="badge b-pending_receipt">Por recibir</span></div>
          <div className="mut">De {nameOf(members, h.from_user)} · {fdt(h.submitted_at)}</div>
        </div>
      ))}
    </>
  );
}

export function Historial({ arg }: { arg?: string }) {
  const { org, go, members } = useCtx();
  const list = useLoad(() => sel(supabase.from('handoffs').select('id,status,from_user,shift_date,submitted_at,areas(name),shift_definitions(name)').eq('org_id', org).neq('status', 'draft').order('submitted_at', { ascending: false }).limit(60)), [org]);
  if (arg) return <HandoffDetail id={arg} back={() => go('historial')} />;
  return (
    <>
      <h2>Historial de entregas</h2>
      <Msg err={list.err} />
      {(list.data ?? []).map((h: Row) => (
        <div className={`card tap s-${h.status}`} key={h.id} onClick={() => go('historial', h.id)}>
          <div className="row"><span className="title">{h.areas?.name} · {h.shift_definitions?.name}</span><span className={`badge b-${h.status}`}>{STATUS_LABEL[h.status]}</span></div>
          <div className="mut">{h.shift_date} · de {nameOf(members, h.from_user)}</div>
        </div>
      ))}
    </>
  );
}

export function HandoffDetail({ id, back, receiving }: { id: string; back: () => void; receiving?: boolean }) {
  const { uid, role, members, go } = useCtx();
  const d = useLoad(async () => {
    const h = (await sel<Row[]>(supabase.from('handoffs').select('*').eq('id', id)))[0];
    const [receipt, addenda, atts] = await Promise.all([
      sel(supabase.from('handoff_receipts').select('*').eq('handoff_id', id)),
      sel(supabase.from('handoff_addenda').select('*').eq('handoff_id', id).order('created_at')),
      sel(supabase.from('attachments').select('id,path').eq('entity_type', 'handoff').eq('entity_id', id)),
    ]);
    return { h, receipt: receipt[0] ?? null, addenda, atts };
  }, [id]);
  const [notes, setNotes] = useState(''); const [ack, setAck] = useState({ checklist: false, issues: false });
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false); const [addendum, setAddendum] = useState('');
  if (!d.data) return <><Msg err={d.err} /><button className="link back" onClick={back}><Ic n="back" size={18} />Volver</button></>;
  const { h, receipt, addenda, atts } = d.data;
  const snap = h.snapshot as Row;
  const canReceive = h.status === 'pending_receipt' && h.from_user !== uid && (!h.to_user || h.to_user === uid || isManager(role));

  async function decide(decision: string) {
    setBusy(true); setErr('');
    try {
      await rpc('receive_handoff', { p_id: id, p_decision: decision, p_notes: notes || null, p_ack: { checklist_reviewed: ack.checklist, issues_acknowledged: ack.issues ? [...snap.issues_created, ...snap.issues_open].map((i: Row) => i.id) : [] } });
      setOk('Decisión registrada por el servidor.'); d.reload();
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  async function pdf() {
    const lines = handoffLines(snap, h, receipt, addenda, receipt ? nameOf(members, receipt.received_by) : undefined);
    setOk(await sharePdf(await pdfFromLines(lines), `handoff-${h.shift_date}-${h.id.slice(0, 8)}.pdf`, 'Entrega de turno'));
  }
  const IssueRow = ({ i }: { i: Row }) => (
    <div className="item" onClick={() => go('pendientes', i.id)}>
      {i.title} <span className={`badge b-${i.priority}`}>{PRIORITY[i.priority]}</span>
      <div className="mut">{i.description} · al enviar: {ISSUE_STATUS[i.status]}</div>
    </div>
  );
  return (
    <>
      <button className="link back" onClick={back}><Ic n="back" size={18} />Volver</button>
      <h2>{snap.handoff.area.name} · {snap.handoff.shift.name}</h2>
      <p className="mut">{snap.handoff.site.name} · {snap.handoff.shift_date} · de {snap.handoff.from_name} · <span className={`badge b-${h.status}`}>{STATUS_LABEL[h.status]}</span><br />Enviada {fdt(h.submitted_at)} · huella {h.snapshot_hash.slice(0, 12)}…</p>
      <div className="card">
        <h3>Contenido entregado</h3>
        {snap.fields.map((f: Row) => <div className="item" key={f.field_id}><b>{f.label}</b><div>{fieldValueText(f)}</div></div>)}
        <Thumbs paths={snap.attachments.map((a: Row) => a.path)} />
      </div>
      <div className="card"><h3>Reportados en este turno</h3>{snap.issues_created.length === 0 && <p className="mut">Ninguno.</p>}{snap.issues_created.map((i: Row) => <IssueRow key={i.id} i={i} />)}</div>
      <div className="card"><h3>Pendientes heredados</h3>{snap.issues_open.length === 0 && <p className="mut">Ninguno.</p>}{snap.issues_open.map((i: Row) => <IssueRow key={i.id} i={i} />)}
        <p className="mut">Recibir la entrega no te hace responsable de resolver estos pendientes: para asumirlos, ábrelos y usa «Asumir responsabilidad».</p></div>
      {addenda.length > 0 && <div className="card"><h3>Anexos posteriores</h3>{addenda.map((a: Row) => <div className="item" key={a.id}>{a.body}<div className="mut">{nameOf(members, a.author)} · {fdt(a.created_at)}</div></div>)}</div>}
      {receipt && <div className="card"><h3>Recepción</h3><b>{{ accepted: 'Aceptada', accepted_with_observations: 'Aceptada con observaciones', discrepancy: 'Discrepancia registrada', rejected: 'Rechazada' }[receipt.decision as string]}</b> por {nameOf(members, receipt.received_by)} · {fdt(receipt.received_at)}<div className="mut">{receipt.notes}</div></div>}
      {(receiving || canReceive) && canReceive && (
        <div className="card">
          <h3>Tu decisión</h3>
          <label><input type="checkbox" checked={ack.checklist} onChange={(e) => setAck({ ...ack, checklist: e.target.checked })} />Revisé el contenido y las fotografías</label>
          <label><input type="checkbox" checked={ack.issues} onChange={(e) => setAck({ ...ack, issues: e.target.checked })} />Quedo enterado de los pendientes (no implica asumir su resolución)</label>
          <label>Observaciones <small>(obligatorias salvo al aceptar)</small><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <button className="btn ok" disabled={busy} onClick={() => decide('accepted')}>ACEPTAR ENTREGA</button>
          <button className="btn" disabled={busy || !notes.trim()} onClick={() => decide('accepted_with_observations')}>ACEPTAR CON OBSERVACIONES</button>
          <button className="btn warn" disabled={busy || !notes.trim()} onClick={() => decide('discrepancy')}>REGISTRAR DISCREPANCIA</button>
          <button className="btn bad" disabled={busy || !notes.trim()} onClick={() => decide('rejected')}>RECHAZAR RECEPCIÓN</button>
        </div>
      )}
      {(uid === h.from_user || isManager(role)) && (
        <div className="card"><h3>Agregar anexo / corrección</h3><p className="mut">La entrega original no se modifica; el anexo queda registrado con fecha y autor.</p>
          <textarea value={addendum} onChange={(e) => setAddendum(e.target.value)} />
          <button className="btn sec" disabled={!addendum.trim() || busy} onClick={async () => { try { await rpc('add_handoff_addendum', { p_id: id, p_body: addendum }); setAddendum(''); d.reload(); } catch (e) { setErr(errText(e)); } }}>Guardar anexo</button></div>
      )}
      <Msg err={err} ok={ok} />
      <button className="btn sec" onClick={pdf}><Ic n="pdf" size={20} />Generar y compartir PDF</button>
      <span hidden>{atts.length}</span>
    </>
  );
}
