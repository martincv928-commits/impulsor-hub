// Topes de uso del modelo de IA por empresa y modo (se miden en tokens; ver migración 0005).
export const isOverLimit = (used: number, limit: number): boolean =>
  Number.isFinite(used) && Number.isFinite(limit) && limit > 0 && used >= limit;

export const limitMessage = (mode: 'gerente' | 'cliente', contact: string): string =>
  mode === 'gerente'
    ? 'Llegaste al límite mensual de uso de AtalaIA incluido en tu plan. Se renueva el día 1 de cada mes. Para ampliarlo, contacta a tu proveedor.'
    : `El asistente no está disponible por ahora.${contact ? ` Puedes contactar a la empresa: ${contact}` : ''}`;
