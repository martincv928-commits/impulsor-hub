import { supabase } from '../supabase';
import { Msg, useCtx, useLoad } from '../ctx';
import { sel } from '../lib';
import { Ic } from '../brand';
import { PRIORITY, STATUS_LABEL } from '../report';

export default function Inicio() {
  const { uid, org, go, role, me, members } = useCtx();
  const d = useLoad(async () => {
    const cfg = role === 'admin'
      ? await Promise.all(['sites', 'areas', 'shift_definitions'].map((t) => sel(supabase.from(t).select('id').eq('org_id', org).limit(1))))
      : null;
    const [toReceive, mine, drafts, recent] = await Promise.all([
      sel(supabase.from('handoffs').select('id,from_user,to_user').eq('org_id', org).eq('status', 'pending_receipt')),
      sel(supabase.from('issues').select('id,title,priority,status').eq('org_id', org).eq('assignee', uid).in('status', ['open', 'in_progress', 'blocked'])),
      sel(supabase.from('handoffs').select('id,shift_date').eq('org_id', org).eq('status', 'draft').eq('from_user', uid)),
      sel(supabase.from('handoffs').select('id,status,shift_date,areas(name),shift_definitions(name)').eq('org_id', org).neq('status', 'draft').order('submitted_at', { ascending: false }).limit(5)),
    ]);
    const rec = toReceive.filter((h: any) => (h.from_user !== uid || members.length === 1) && (!h.to_user || h.to_user === uid || role !== 'worker'));
    return { rec, mine, drafts, recent, cfg: cfg ? { sites: cfg[0].length, areas: cfg[1].length, shifts: cfg[2].length } : null };
  }, [org, uid]);
  if (d.loading) return <p className="mut">Cargando…</p>;
  if (!d.data) return <><Msg err={d.err} /><button className="btn" onClick={d.reload}>Reintentar</button></>;
  const { rec, mine, drafts, recent, cfg } = d.data;
  const steps = cfg ? [['Crea una sede (tu planta, sucursal o local)', cfg.sites > 0, 'estructura'], ['Crea un área dentro de la sede', cfg.areas > 0, 'estructura'], ['Crea un turno (por ejemplo Matutino)', cfg.shifts > 0, 'estructura'], ['Invita a tu equipo con un código', members.length > 1, 'equipo']] as const : [];
  const setupDone = steps.every((s) => s[1]);
  const first = me.split(' ')[0];
  const date = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <div className="hero">
        <div className="eyebrow">{date}</div>
        <h2>Hola, {first}</h2>
        <p>{rec.length ? `Tienes ${rec.length} ${rec.length === 1 ? 'turno' : 'turnos'} esperando tu recepción.` : mine.length ? `Tienes ${mine.length} ${mine.length === 1 ? 'pendiente asignado' : 'pendientes asignados'}.` : 'Todo al día. Nada pendiente por recibir.'}</p>
      </div>
      {cfg && !setupDone && (
        <div className="card">
          <h3>Configura HANDOFF en 4 pasos</h3>
          <ol className="steps">
            {steps.map(([t, done], n) => <li key={t} className={done ? 'done' : ''}><span className="n">{done ? '✓' : n + 1}</span><span className="t">{t}</span></li>)}
          </ol>
          <button className="btn" onClick={() => go('config', steps.find((s) => !s[1])?.[2])}>Continuar configuración</button>
        </div>
      )}
      {!cfg && recent.length === 0 && rec.length === 0 && (
        <div className="card">
          <h3>Cómo funciona</h3>
          <ol className="steps">
            <li><span className="n">1</span><span className="t">Al terminar tu turno toca <b>Entregar</b>, llena la lista y envía.</span></li>
            <li><span className="n">2</span><span className="t">Quien entra revisa en <b>Recibir</b> y acepta o reporta una discrepancia.</span></li>
            <li><span className="n">3</span><span className="t">Los pendientes se quedan abiertos con responsable hasta resolverse.</span></li>
          </ol>
        </div>
      )}
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
