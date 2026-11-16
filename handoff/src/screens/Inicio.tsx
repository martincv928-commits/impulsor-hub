import { supabase } from '../supabase';
import { Msg, useCtx, useLoad } from '../ctx';
import { sel } from '../lib';
import { STATUS_LABEL } from '../report';

export default function Inicio() {
  const { uid, org, go, role } = useCtx();
  const d = useLoad(async () => {
    const [toReceive, mine, drafts, recent] = await Promise.all([
      sel(supabase.from('handoffs').select('id,from_user,to_user').eq('org_id', org).eq('status', 'pending_receipt')),
      sel(supabase.from('issues').select('id,title,priority,status').eq('org_id', org).eq('assignee', uid).in('status', ['open', 'in_progress', 'blocked'])),
      sel(supabase.from('handoffs').select('id,shift_date').eq('org_id', org).eq('status', 'draft').eq('from_user', uid)),
      sel(supabase.from('handoffs').select('id,status,shift_date,areas(name),shift_definitions(name)').eq('org_id', org).neq('status', 'draft').order('submitted_at', { ascending: false }).limit(5)),
    ]);
    const rec = toReceive.filter((h: any) => h.from_user !== uid && (!h.to_user || h.to_user === uid || role !== 'worker'));
    return { rec, mine, drafts, recent };
  }, [org, uid]);
  if (d.loading) return <p className="mut">Cargando…</p>;
  if (!d.data) return <><Msg err={d.err} /><button className="btn" onClick={d.reload}>Reintentar</button></>;
  const { rec, mine, drafts, recent } = d.data;
  return (
    <>
      <h2>Inicio</h2>
      <div className="grid">
        <div className={`stat ${rec.length ? 'hot' : ''}`} onClick={() => go('recibir')}><b>{rec.length}</b>Turnos por recibir</div>
        <div className="stat" onClick={() => go('pendientes')}><b>{mine.length}</b>Mis pendientes</div>
      </div>
      <button className="btn" onClick={() => go('entregar')}>📤 {drafts.length ? `Continuar entrega (${drafts.length} borrador)` : 'Entregar turno'}</button>
      <h3>Mis pendientes abiertos</h3>
      <div className="card">
        {mine.length === 0 && <p className="mut">Nada asignado a ti.</p>}
        {mine.map((i: any) => <div key={i.id} className="item" onClick={() => go('pendientes', i.id)}>{i.title} <span className={`badge b-${i.priority}`}>{i.priority}</span></div>)}
      </div>
      <h3>Últimas entregas</h3>
      <div className="card">
        {recent.length === 0 && <p className="mut">Aún no hay entregas.</p>}
        {recent.map((h: any) => (
          <div key={h.id} className="item row" onClick={() => go('historial', h.id)}>
            <span>{h.areas?.name} · {h.shift_definitions?.name}<div className="mut">{h.shift_date}</div></span>
            <span className={`badge b-${h.status}`}>{STATUS_LABEL[h.status]}</span>
          </div>
        ))}
      </div>
    </>
  );
}
