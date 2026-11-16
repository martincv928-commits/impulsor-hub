# HANDOFF API v1

Base: `https://<ref>.supabase.co/functions/v1/api-v1` · Auth: `Authorization: Bearer hf_…` (clave creada por un administrador en Configuración → API; se muestra una sola vez, se guarda su hash SHA-256; revocable). La clave queda limitada a su empresa y actúa como el usuario que la creó. Respuestas JSON `{data}` o `{error, detail}` (401 sin clave válida, 403 sin permiso, 404, 422 validación).

| Método y ruta | Descripción |
|---|---|
| `GET /v1/handoffs?status=&limit=` | Entregas enviadas (no borradores), más recientes primero (máx. 100). |
| `GET /v1/handoffs/{id}` | Entrega con `snapshot` inmutable, `snapshot_hash` y recepción. |
| `GET /v1/issues?status=&limit=` | Pendientes/incidencias. |
| `POST /v1/issues` | `{site_id, area_id, title, description?, category?, priority? low\|medium\|high\|critical, due_date?, external_ref?, handoff_id?, assignee?, id?}` |
| `POST /v1/handoffs` | `{site_id, area_id, shift_id, template_id, shift_date, to_user?, responses?: {field_id: value}, submit?: bool, id?}` |

**Idempotencia:** envía `id` (UUID) o cabecera `Idempotency-Key` (UUID); reintentar con el mismo id no duplica.

## Webhooks
Eventos: `handoff.created`, `handoff.submitted`, `handoff.accepted`, `handoff.disputed`, `handoff.rejected`, `issue.created`, `issue.assigned`, `issue.resolved`.
Cuerpo: `{id, type, created_at, organization_id, data}` (el `id` es estable entre reintentos: úsalo para deduplicar). Cabeceras: `X-Handoff-Event`, `X-Handoff-Delivery`, `X-Handoff-Signature: t=<unix>,v1=<HMAC-SHA256(secret, "<t>.<body>")>`. Reintentos con retroceso exponencial (1, 2, 4, 8, 16 min); tras 6 intentos queda `failed`. Sólo URLs `https`.

## Estado real
- Esquema, RPCs y cola de webhooks: probados (`npm test`, PGlite).
- Funciones `api-v1` y `webhook-dispatch` (Deno): escritas, **no desplegadas ni probadas** contra un proyecto Supabase real.
- El envío periódico de webhooks necesita un programador (pg_cron+pg_net o externo) con `DISPATCH_SECRET`: pendiente.
