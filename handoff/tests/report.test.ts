import { describe, expect, it } from 'vitest';
import { handoffLines, summaryLines } from '../src/report';

describe('reporte (contenido)', () => {
  const s = {
    generated_at: '2026-11-16T12:00:00Z', from: '2026-11-10', to: '2026-11-16',
    handoffs: { pending_receipt: 2, accepted: 5, accepted_obs: 1, disputed: 1, rejected: 0 },
    issues: { open: 4, critical: 1, overdue: 2, unassigned: 3, blocked: 1, created_in_range: 6, resolved_in_range: 2 },
    pending_list: [{ site: 'Planta', area: 'Almacén', shift: 'Matutino', shift_date: '2026-11-16', from_name: 'Ana', age_minutes: 95 }],
    disputed_list: [{ area: 'Almacén', shift_date: '2026-11-15', status: 'disputed', notes: 'Faltan llaves' }],
    critical_list: [{ priority: 'critical', title: 'Máquina averiada', status: 'open', assignee: null, due_date: null }],
    resolved_list: [{ title: 'Fuga', resolved_by: 'Luis', resolved_at: '2026-11-16T10:00:00Z' }],
  };
  it('incluye exactamente las cifras recibidas', () => {
    const t = summaryLines(s, 'Empresa A').join('\n');
    expect(t).toContain('Por recibir (actual): 2');
    expect(t).toContain('Con discrepancia: 1');
    expect(t).toContain('Sin responsable: 3');
    expect(t).toContain('hace 95 min');
    expect(t).toContain('Faltan llaves');
    expect(t).toContain('SIN RESPONSABLE');
    expect(t).toContain('Luis');
  });
  it('reporte de entrega: contenido, huella y aclaración recibir≠responsabilidad', () => {
    const snap = {
      handoff: { site: { name: 'Planta' }, area: { name: 'Almacén' }, shift: { name: 'Matutino' }, shift_date: '2026-11-16', from_name: 'Ana', to_name: null },
      fields: [{ label: '¿Equipos funcionando?', type: 'boolean', value: false }, { label: 'Limpieza', type: 'checklist', value: { Cocina: true, Baños: false } }],
      issues_created: [{ priority: 'high', title: 'Fuga', status: 'open', description: 'en baño' }], issues_open: [],
    };
    const t = handoffLines(snap, { id: 'h1', status: 'accepted_obs', submitted_at: '2026-11-16T08:00:00Z', snapshot_hash: 'abc' },
      { decision: 'accepted_with_observations', received_by: 'u', received_at: '2026-11-16T09:00:00Z', notes: 'Revisar fuga' }, [], 'Beto').join('\n');
    expect(t).toContain('¿Equipos funcionando?: No');
    expect(t).toContain('☑ Cocina, ☐ Baños');
    expect(t).toContain('SHA-256): abc');
    expect(t).toContain('Receptor: Beto');
    expect(t).toContain('no implica aceptar la responsabilidad');
  });
});
