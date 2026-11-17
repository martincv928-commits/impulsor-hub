import { useRef, useState } from 'react';
import { api } from './supabase';

interface Att { filename: string; mime: string; base64: string }
interface Msg { role: 'user' | 'assistant'; text: string; atts?: Att[] }

function download(a: Att) {
  const bin = atob(a.base64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u], { type: a.mime }));
  const l = document.createElement('a'); l.href = url; l.download = a.filename; l.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function Chat({ tenantId }: { tenantId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const conv = useRef<string | null>(null); const end = useRef<HTMLDivElement>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault(); const t = text.trim(); if (!t || busy) return;
    setText(''); setBusy(true); setMsgs((m) => [...m, { role: 'user', text: t }]);
    try {
      const r = await api<{ conversation_id: string; reply: string; attachments: Att[] }>({ action: 'chat', tenant_id: tenantId, conversation_id: conv.current, message: t });
      conv.current = r.conversation_id;
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply, atts: r.attachments }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', text: '⚠ ' + (e as Error).message }]); }
    setBusy(false); setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }
  const ideas = ['¿Cuánto vendimos este mes?', 'Cuentas por cobrar vencidas', 'Reporte de ventas del mes en Excel'];
  return (
    <div className="chat">
      <div className="msgs">
        {!msgs.length && <div className="muted">Pregúntame sobre ventas, cobranza, inventario o clientes. Sólo consulto; no modifico nada en tu ERP.<div className="chips">{ideas.map((i) => <button key={i} onClick={() => setText(i)}>{i}</button>)}</div></div>}
        {msgs.map((m, i) => (
          <div key={i} className={'msg ' + m.role}>{m.text}
            {m.atts?.map((a) => <button key={a.filename} className="att" onClick={() => download(a)}>⬇ {a.filename}</button>)}
          </div>
        ))}
        {busy && <div className="msg assistant muted">Consultando…</div>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu pregunta…" maxLength={4000} />
        <button disabled={busy}>Enviar</button>
      </form>
    </div>
  );
}
