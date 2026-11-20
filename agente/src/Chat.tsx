import { useEffect, useRef, useState } from 'react';
import { api, supabase } from './supabase';

interface Att { filename: string; mime: string; base64: string }
interface Msg { role: 'user' | 'assistant'; text: string; atts?: Att[]; error?: boolean }

function download(a: Att) {
  const bin = atob(a.base64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u], { type: a.mime }));
  const l = document.createElement('a'); l.href = url; l.download = a.filename; l.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function Chat({ tenantId, isAdmin, goConfig }: { tenantId: string; isAdmin: boolean; goConfig: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [erpOk, setErpOk] = useState<boolean | null>(null);
  const conv = useRef<string | null>(null); const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.rpc('erp_connection_public', { p_tenant: tenantId }).then(({ data }) => setErpOk(!!data?.[0] && data[0].status === 'ok'));
  }, [tenantId, isAdmin]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  async function send(e: React.FormEvent, preset?: string) {
    e.preventDefault(); const t = (preset ?? text).trim(); if (!t || busy) return;
    setText(''); setBusy(true); setMsgs((m) => [...m, { role: 'user', text: t }]);
    try {
      const r = await api<{ conversation_id: string; reply: string; attachments: Att[] }>({ action: 'chat', tenant_id: tenantId, conversation_id: conv.current, message: t });
      conv.current = r.conversation_id;
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply, atts: r.attachments }]);
    } catch (err) { setMsgs((m) => [...m, { role: 'assistant', text: (err as Error).message, error: true }]); }
    setBusy(false);
  }
  const ideas = ['¿Cuánto vendimos este mes?', 'Cuentas por cobrar vencidas', 'Reporte de ventas del mes en Excel', 'Productos con poco inventario'];
  return (
    <div className="chat">
      <div className="msgs" aria-live="polite">
        {!msgs.length && (
          <div className="empty">
            <h2>¿Qué quieres saber de tu negocio?</h2>
            <p className="muted">Consulto tu ERP en tiempo real. Sólo leo datos; no modifico nada.</p>
            {isAdmin && erpOk === false && <button className="warn" onClick={goConfig}>Aún no conectas tu ERP · Conectar ahora</button>}
            <div className="chips">{ideas.map((i) => <button key={i} onClick={(e) => send(e, i)}>{i}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'msg ' + m.role + (m.error ? ' err' : '')}>{m.text}
            {m.atts?.map((a) => <button key={a.filename} className="att" onClick={() => download(a)}>⬇ {a.filename}</button>)}
          </div>
        ))}
        {busy && <div className="msg assistant typing" aria-label="Consultando"><span /><span /><span /></div>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu pregunta…" maxLength={4000} aria-label="Mensaje" />
        <button disabled={busy || !text.trim()}>Enviar</button>
      </form>
    </div>
  );
}
