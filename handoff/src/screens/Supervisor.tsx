import { useState } from 'react';
import { Msg, useCtx, useLoad } from '../ctx';
import { pdfFromLines, rpc, sharePdf, today } from '../lib';
import { ISSUE_STATUS, PRIORITY, STATUS_LABEL, summaryLines, type Row } from '../report';

export default function Supervisor() {
  const { org, orgName, go } = useCtx();
  const [days, setDays] = useState(7); const [ok, setOk] = useState('');
  const from = new Date(Date.now() - days * 864e5).toLocaleDateString('en-CA');
  const d = useLoad(() => rpc<Row>('supervisor_summary', { p_org: org, p_from: from, p_to: today() }), [org, days]);
  if (!d.data) return <><Msg err={d.err} /><p className="mut">Cargando…</p></>;
  const s = d.data;
  const Stat = ({ n, l, hot, to }: { n: number; l: string; hot?: boolean; to?: string }) => <div className={`stat ${hot && n > 0 ? 'hot' : ''}`} onClick={() => to && go(to)}><b>{n}</b>{l}</div>;
  return (
    <>
      <h2>Supervisor</h2>
      <div className="row" style={{ justifyContent: 'flex-start' }}>{[1, 7, 30].map((n) => <button key={n} className="pill" style={days === n ? { background: 'var(--pri)', color: '#fff' } : {}} onClick={() => setDays(n)}>{n === 1 ? 'Hoy' : `${n} días`}</button>)}</div>
      <h3>Turnos</h3>
      <div className="grid"><Stat n={s.handoffs.pending_receipt} l="Por recibir" hot to="recibir" /><Stat n={s.handoffs.accepted + s.handoffs.accepted_obs} l="Recibidos" /><Stat n={s.handoffs.disputed + s.handoffs.rejected} l="Con discrepancia / rechazo" hot to="historial" /></div>
      <h3>Pendientes</h3>
      <div className="grid"><Stat n={s.issues.critical} l="Críticos" hot to="pendientes" /><Stat n={s.issues.overdue} l="Vencidos" hot to="pendientes" /><Stat n={s.issues.unassigned} l="Sin responsable" hot to="pendientes" /><Stat n={s.issues.blocked} l="Bloqueados" hot to="pendientes" /></div>
      {s.pending_list.length > 0 && <div className="card"><h3>Entregas sin aceptar</h3>{s.pending_list.map((p: Row) => <div className="item" key={p.id} onClick={() => go('recibir', p.id)}>{p.area} · {p.shift} <span className="mut">· de {p.from_name} · hace {p.age_minutes} min</span></div>)}</div>}
      {s.disputed_list.length > 0 && <div className="card"><h3>Discrepancias / rechazos</h3>{s.disputed_list.map((p: Row) => <div className="item" key={p.id} onClick={() => go('historial', p.id)}><span className={`badge b-${p.status}`}>{STATUS_LABEL[p.status]}</span> {p.area} · {p.shift_date}<div className="mut">{p.notes}</div></div>)}</div>}
      {s.critical_list.length > 0 && <div className="card"><h3>Requieren atención</h3>{s.critical_list.map((p: Row) => <div className="item" key={p.id} onClick={() => go('pendientes', p.id)}>{p.title} <span className={`badge b-${p.priority}`}>{PRIORITY[p.priority]}</span><div className="mut">{ISSUE_STATUS[p.status]}{p.assignee ? '' : ' · sin responsable'}{p.due_date ? ` · vence ${p.due_date}` : ''}</div></div>)}</div>}
      <div className="card"><h3>Actividad reciente</h3>{s.recent_activity.length === 0 && <p className="mut">Sin actividad.</p>}{s.recent_activity.map((a: Row, i: number) => <div className="item mut" key={i}>{a.action} · {a.actor ?? '—'} · {new Date(a.at).toLocaleString('es-MX')}</div>)}</div>
      <Msg ok={ok} />
      <button className="btn" onClick={async () => setOk(await sharePdf(pdfFromLines(summaryLines(s, orgName)), `handoff-resumen-${today()}.pdf`, 'HANDOFF — Resumen de turno'))}>📄 Generar y compartir resumen PDF</button>
      <button className="link" onClick={d.reload}>Actualizar</button>
    </>
  );
}
