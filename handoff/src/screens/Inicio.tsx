import { supabase } from '../supabase';
import { Msg, useCtx, useLoad } from '../ctx';
import { sel } from '../lib';
import { Ic } from '../brand';
import { PRIORITY, STATUS_LABEL } from '../report';

export default function Inicio() {
  const { uid, org, go, role, me } = useCtx();
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
  const first = me.split(' ')[0];
  const date = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <div className="hero">
        <div className="eyebrow">{date}</div>
        <h2>Hola, {first}</h2>
        <p>{rec.length ? `Tienes ${rec.length} ${rec.length === 1 ? 'turno' : 'turnos'} esperando tu recepción.` : mine.length ? `Tienes ${mine.length} ${mine.length === 1 ? 'pendiente asignado' : 'pendientes asignados'}.` : 'Todo al día. Nada pendiente por recibir.'}</p>
      </div>
      <div className="grid">
        <div className={`stat ${rec.length ? 'hot' : ''}`} onClick={() => go('recibir')}><span className="ico"><Ic n="inbox" size={19} /></span><b>{rec.length}</b><span className="l">Turnos por recibir</span></div>
        <div className="stat amber" onClick={() => go('pendientes')}><span className="ico"><Ic n="pin" size={19} /></span><b>{mine.length}</b><span className="l">Mis pendientes</span></div>
      </div>
      <button className="btn" onClick={() => go('entregar')}><Ic n="send" size={21} />{drafts.length ? 'Continuar entrega en borrador' : 'Entregar turno'}</button>
      <h3>Mis pendientes abiertos</h3>
      <div className="card">
        {mine.length === 0 && <div className="empty"><div className="ico"><Ic n="check" size={26} /></div>Nada asignado a ti.</div>}
        {mine.map((i: any) => <div key={i.id} className="item tap row" onClick={() => go('pendientes', i.id)}><span className="title">{i.title}</span><span className={`badge b-${i.priority}`}>{PRIORITY[i.priority]}</span></div>)}
      </div>
      <h3>Últimas entregas</h3>
      <div className="card">
        {recent.length === 0 && <div className="empty"><div className="ico"><Ic n="send" size={26} /></div>Aún no hay entregas.</div>}
        {recent.map((h: any) => (
          <div key={h.id} className="item tap row" onClick={() => go('historial', h.id)}>
            <span><span className="title">{h.areas?.name} · {h.shift_definitions?.name}</span><div className="mut">{h.shift_date}</div></span>
            <span className={`badge b-${h.status}`}>{STATUS_LABEL[h.status]}</span>
          </div>
        ))}
      </div>
    </>
  );
}
