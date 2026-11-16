# CLAUDE.md — HANDOFF (Impulsor) · V0.1 (nombre provisional)

Único archivo de instrucciones persistentes de este proyecto. Producto INDEPENDIENTE (no es PROOF, FiscalBox ni Ventor). No asumir disponibilidad comercial del nombre.

## Eficiencia (permanente)
- Inspeccionar sólo archivos relacionados; no explorar el repo completo ni releer sin necesidad.
- Reutilizar lo existente; agrupar cambios; sin refactors generales; sin cambiar tecnología funcional.
- Sin documentación extensa ni funciones fuera de alcance. Un solo build; correcciones concretas; smoke test; detenerse al cumplir aceptación.
- Flujo: INSPECCIÓN DIRIGIDA → IMPLEMENTACIÓN → BUILD → CORRECCIÓN → SMOKE TEST → ENTREGA → DETENERSE.
- Excepción: NO recortar seguridad, aislamiento entre empresas, integridad de datos ni el funcionamiento de entrega/recepción. Cada bug de integridad → test de regresión en `tests/db.test.ts`.
- Sin credenciales o autorización externa: preparar lo posible y señalar el paso exacto. Nunca simular conexiones, envíos ni sincronización.

## Stack y reglas técnicas
- Vite + React + TypeScript (PWA móvil, Android-first) + Supabase (Postgres/RLS/Storage/Edge Functions). Tests: vitest + PGlite (`npm test`), ejecutan las migraciones reales.
- Toda escritura crítica pasa por RPC `SECURITY DEFINER` (`supabase/migrations/0001`). Clientes sin INSERT/UPDATE/DELETE directo salvo configuración de admin. Nunca `service_role` en frontend.
- Entrega enviada = snapshot inmutable (+hash); correcciones = anexos (`handoff_addenda`). Historial (`issue_events`, `audit_events`, `handoff_receipts`) es append-only.
- RECIBIR información ≠ ACEPTAR responsabilidad (acciones separadas).
- Fuera de alcance V0.1: nómina, checador, facial, GPS continuo, inventario, facturación, ERP, IA generativa, chat, pagos, conectores específicos, multi-idioma. No pasar a V0.2 sin aprobación.
- Sin secretos en el repo. Frontend sólo URL + publishable key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Respuestas finales BREVES; el usuario trabaja desde Android.

## Backend
- Supabase proyecto `handoff` (ref `hppzsirfbvvwgdlhhhvt`, us-east-1, org Quoteflow). URL: https://hppzsirfbvvwgdlhhhvt.supabase.co. Migraciones 0001 y 0002 aplicadas.
- Plan gratis = 2 proyectos activos: fiscalbox está PAUSADO para dar cupo (reactivarlo pausando handoff). Ventor (producción) no se toca.

## Firma del APK
- `handoff/signing/debug.keystore` es una llave de PRUEBAS pública a propósito (alias androiddebugkey, pass `android`): mantiene la misma firma entre builds para poder instalar encima. NO usar para Google Play ni datos reales; para publicar se crea una llave de subida distinta fuera del repo (secretos de GitHub).
