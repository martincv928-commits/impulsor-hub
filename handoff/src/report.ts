// Funciones puras para armar el contenido de reportes (testeables). Sólo usan datos recibidos: sin inventar cifras.
export type Row = Record<string, any>;

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador', pending_receipt: 'Pendiente de recepción', accepted: 'Aceptada',
  accepted_obs: 'Aceptada con observaciones', disputed: 'Con discrepancia', rejected: 'Rechazada',
};
export const ISSUE_STATUS: Record<string, string> = {
  open: 'Abierto', in_progress: 'En proceso', blocked: 'Bloqueado', resolved: 'Resuelto', cancelled: 'Cancelado',
};
export const PRIORITY: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-MX') : '—');

export function fieldValueText(f: Row): string {
  const v = f.value;
  if (v === null || v === undefined || v === '') return '—';
  if (f.type === 'boolean') return v ? 'Sí' : 'No';
  if (f.type === 'checklist' && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${x ? '☑' : '☐'} ${k}`).join(', ');
  if (f.type === 'photo' && Array.isArray(v)) return `${v.length} fotografía(s)`;
  return String(v);
}

export function summaryLines(s: Row, org: string): string[] {
  const h = s.handoffs, i = s.issues;
  const L = [
    `HANDOFF — Resumen de turno`, `Empresa: ${org}`, `Periodo: ${s.from} a ${s.to}`, `Generado: ${fmt(s.generated_at)}`, '',
    'TURNOS',
    `Por recibir (actual): ${h.pending_receipt}`, `Aceptados: ${h.accepted}`, `Aceptados con observaciones: ${h.accepted_obs}`,
    `Con discrepancia: ${h.disputed}`, `Rechazados: ${h.rejected}`, '',
    'PENDIENTES',
    `Abiertos: ${i.open}`, `Críticos: ${i.critical}`, `Vencidos: ${i.overdue}`, `Sin responsable: ${i.unassigned}`, `Bloqueados: ${i.blocked}`,
    `Creados en el periodo: ${i.created_in_range}`, `Resueltos en el periodo: ${i.resolved_in_range}`, '',
  ];
  if (s.pending_list.length) {
    L.push('ENTREGAS SIN ACEPTAR');
    s.pending_list.forEach((p: Row) => L.push(`- ${p.site} / ${p.area} · ${p.shift} · ${p.shift_date} · de ${p.from_name} · hace ${p.age_minutes} min`));
    L.push('');
  }
  if (s.disputed_list.length) {
    L.push('DISCREPANCIAS Y RECHAZOS');
    s.disputed_list.forEach((p: Row) => L.push(`- ${p.area} · ${p.shift_date} · ${STATUS_LABEL[p.status]}: ${p.notes}`));
    L.push('');
  }
  if (s.critical_list.length) {
    L.push('PENDIENTES QUE REQUIEREN ATENCIÓN');
    s.critical_list.forEach((p: Row) => L.push(`- [${PRIORITY[p.priority]}] ${p.title} · ${ISSUE_STATUS[p.status]}${p.assignee ? '' : ' · SIN RESPONSABLE'}${p.due_date ? ' · vence ' + p.due_date : ''}`));
    L.push('');
  }
  if (s.resolved_list.length) {
    L.push('RESUELTOS');
    s.resolved_list.forEach((p: Row) => L.push(`- ${p.title} · por ${p.resolved_by ?? '—'} · ${fmt(p.resolved_at)}`));
  }
  return L;
}

export function handoffLines(snap: Row, handoff: Row, receipt: Row | null, addenda: Row[], receiverName?: string): string[] {
  const h = snap.handoff;
  const L = [
    'HANDOFF — Entrega de turno', `ID: ${handoff.id}`,
    `Sede / Área: ${h.site.name} / ${h.area.name}`, `Turno: ${h.shift.name} · Fecha: ${h.shift_date}`,
    `Entrega: ${h.from_name} · Enviada: ${fmt(handoff.submitted_at)}`,
    `Receptor designado: ${h.to_name ?? '(cualquiera del equipo)'}`,
    `Estado: ${STATUS_LABEL[handoff.status]}`, `Huella de contenido (SHA-256): ${handoff.snapshot_hash}`, '', 'CONTENIDO ENTREGADO',
  ];
  snap.fields.forEach((f: Row) => L.push(`- ${f.label}: ${fieldValueText(f)}`));
  const list = (title: string, a: Row[]) => {
    if (!a.length) return;
    L.push('', title);
    a.forEach((i) => L.push(`- [${PRIORITY[i.priority]}] ${i.title} · ${ISSUE_STATUS[i.status]}${i.description ? ' — ' + i.description : ''}`));
  };
  list('PENDIENTES / INCIDENCIAS REPORTADOS EN ESTA ENTREGA', snap.issues_created);
  list('PENDIENTES HEREDADOS ABIERTOS AL ENVIAR', snap.issues_open);
  L.push('', 'RECEPCIÓN');
  if (receipt) {
    L.push(`Decisión: ${{ accepted: 'Aceptada', accepted_with_observations: 'Aceptada con observaciones', discrepancy: 'Discrepancia', rejected: 'Rechazada' }[receipt.decision as string]}`,
      `Receptor: ${receiverName ?? receipt.received_by} · ${fmt(receipt.received_at)}`, `Observaciones: ${receipt.notes ?? '—'}`,
      'Nota: recibir la información no implica aceptar la responsabilidad de resolver los pendientes.');
  } else L.push('Aún no recibida.');
  if (addenda.length) {
    L.push('', 'ANEXOS / CORRECCIONES POSTERIORES');
    addenda.forEach((a) => L.push(`- ${fmt(a.created_at)}: ${a.body}`));
  }
  return L;
}
