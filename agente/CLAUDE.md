# CLAUDE.md — AGENTE (Impulsor) · nombre provisional

Producto INDEPENDIENTE (no es Hub, Handoff, FiscalBox ni Ventor). Especificación: `docs/SPEC.md` (leer de ahí; no reescribirla). No asumir disponibilidad comercial del nombre.

## Reglas permanentes
- Eficiencia: inspección dirigida, cambios agrupados, un build, smoke test, detenerse al cumplir aceptación. Respuestas finales BREVES; el usuario trabaja desde Android.
- SOLO CONSULTA: ningún conector ERP puede escribir. El tipo `ErpConnector` sólo expone métodos de lectura.
- Aislamiento entre empresas (tenants) y entre modos (Gerente vs. Cliente) NO se recorta: cada bug → test de regresión.
- Cifras que el agente da salen de herramientas (ERP), nunca "de memoria" del LLM. Si no hay dato: decir que no lo sabe.
- Nunca simular conexiones (ERP, WhatsApp, voz). Sin credenciales: preparar lo posible y señalar el paso exacto.
- Sin secretos en el repo. Credenciales de ERP cifradas por tenant en servidor; nunca en frontend.
- Stack: Vite + React + TS (PWA/Android), Supabase (Postgres/RLS/Edge Functions), vitest.
