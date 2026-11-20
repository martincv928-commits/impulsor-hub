# CLAUDE.md — ATALAIA (Impulsor) · carpeta `agente/`

Producto INDEPENDIENTE (no es Hub, Handoff, FiscalBox ni Ventor). Nombre: **AtalaIA** (Atalaya → AtalaIA el 2026-11-20; el ID técnico `atalaya` se conserva) ("Tu negocio, a la vista."); sin verificar disponibilidad comercial. Identidad en `src/brand.ts` y `brand/`. ID del paquete Android (permanente): `mx.impulsor.atalaya`. Especificación: `docs/SPEC.md` (leer de ahí; no reescribirla). Guía de operación: `README.md`.

## Reglas permanentes
- Eficiencia: inspección dirigida, cambios agrupados, un build, smoke test, detenerse al cumplir aceptación. Respuestas finales BREVES; el usuario trabaja desde Android.
- SOLO CONSULTA: ningún conector ERP puede escribir. El tipo `ErpConnector` sólo expone métodos de lectura.
- Aislamiento entre empresas (tenants) y entre modos (Gerente vs. Cliente) NO se recorta: cada bug → test de regresión.
- Cifras que el agente da salen de herramientas (ERP), nunca "de memoria" del LLM. Si no hay dato: decir que no lo sabe.
- Nunca simular conexiones (ERP, WhatsApp, voz). Sin credenciales: preparar lo posible y señalar el paso exacto.
- Sin secretos en el repo. Credenciales de ERP cifradas por tenant en servidor; nunca en frontend.
- Stack: Vite + React + TS (PWA/Android), Supabase (Postgres/RLS/Edge Functions), vitest.

## Entrega
- APK: workflow `ATALAIA APK` (push a master con cambios en `agente/`) → `https://github.com/martincv928-commits/impulsor-hub/releases/download/agente-apk-latest/atalaya.apk`. PR → `ATALAIA CI`.
- Backend Supabase `agente` (ref `lsbayfiblnylafyuxbeh`): migraciones y función `api` se aplican/despliegan antes de fusionar cambios que dependan de ellas.
