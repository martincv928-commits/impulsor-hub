# AGENTE — Especificación V0.1 (nombre provisional)

## 1. Producto
Agente de IA multiempresa (SaaS) que se conecta a UN ERP por empresa, **sólo lectura**, y opera en dos modos:

| | Modo Gerente (interno) | Modo Cliente (público) |
|---|---|---|
| Usuarios | Dueño / gerentes autenticados | Visitantes anónimos del sitio web |
| Canales | App (texto, voz), WhatsApp | Widget de chat web (WhatsApp después) |
| Fuentes | ERP (herramientas de lectura) + reglas de la empresa | SÓLO base de conocimiento pública + (opcional) catálogo público del ERP |
| Salidas | Texto, voz, PDF, Excel | Texto |

## 2. Reglas duras
1. Sólo consulta. El agente no crea, modifica ni borra nada en ningún ERP.
2. El modo Cliente jamás tiene herramientas del ERP privadas; sólo las marcadas `public` por el admin (p. ej. catálogo/precios de lista). Separación a nivel de herramientas, no sólo de prompt.
3. Cifras (ventas, saldos, inventario) provienen de una herramienta; el LLM no calcula ni inventa. Cada respuesta con datos guarda en bitácora: herramienta, parámetros, fecha, fuente.
4. Reglas de la empresa (lo que no debe hacer, temas delicados, tono) se inyectan como instrucciones de sistema Y se aplican con filtros determinísticos (lista de temas prohibidos, límites por rol).
5. Un tenant nunca ve datos de otro (RLS + pruebas).

## 3. Arquitectura
- **Core del agente** (Edge Function): recibe mensaje + contexto (tenant, modo, usuario) → LLM con herramientas → respuesta. Proveedor LLM detrás de una interfaz.
- **Conectores ERP** — interfaz común `ErpConnector` (sólo lectura): `ping()`, `listTools()`, y consultas normalizadas: `ventas(periodo)`, `cuentasPorCobrar()`, `cuentasPorPagar()`, `inventario(filtro)`, `clientes(filtro)`, `productos(filtro)`, `caja/bancos()`. Cada ERP = un adaptador que mapea a este contrato. Fase 1: **Odoo** (JSON-RPC/XML-RPC; usuario de API con permisos de sólo lectura). Siguientes: los que pidan clientes; un "conector genérico" por API REST/CSV/SQL de sólo lectura se evalúa después.
- **Panel de configuración** (por empresa): datos de la empresa, instrucciones y prohibiciones, tono, ERP (credenciales cifradas, prueba de conexión), qué herramientas son públicas, usuarios y roles, sitio web (dominios permitidos, fuentes de conocimiento: URLs/archivos).
- **Conocimiento del sitio web**: ingesta de URLs/PDF indicados por el admin → fragmentos + embeddings (pgvector) por tenant → recuperación en modo Cliente. Responde sólo con lo recuperado; si no hay, deriva a un humano (captura de contacto).
- **Canales**: (a) PWA/app Gerente con chat; (b) widget web embebible (`<script>` + token público por tenant, dominios permitidos, límite de tasa); (c) WhatsApp Cloud API (Meta) — requiere cuenta Business y verificación; (d) voz: nota de voz → transcripción → agente → texto/voz.
- **Reportes**: el agente pide un reporte → generador determinístico (PDF/Excel) a partir de datos de herramientas → se entrega por chat/WhatsApp (URL firmada con caducidad).
- **Seguridad/auditoría**: `audit_events` append-only; roles (admin, gerente, lector); autenticación de números de WhatsApp autorizados por tenant; límites de uso por plan.

## 4. Modelo de datos (esquema inicial)
`tenants`, `members` (usuario↔tenant↔rol), `tenant_settings` (reglas, tono, prohibiciones), `erp_connections` (tipo, url, credenciales cifradas, estado), `tools_exposed` (herramienta, visible_publico), `knowledge_sources` / `knowledge_chunks` (pgvector), `channels` (web/whatsapp, config, dominios/números), `conversations` / `messages`, `tool_calls` (traza), `reports`, `audit_events`, `usage_counters`. Todo con `tenant_id` + RLS.

## 5. Fases
- **F1 (MVP):** panel de configuración + conector Odoo (lectura) + chat Gerente en app + widget web modo Cliente con base de conocimiento + bitácora + 1 reporte en PDF y Excel. Tests: aislamiento por tenant, separación de modos, conector contra Odoo simulado de fixtures (nunca presentado como real), sólo lectura.
- **F2:** WhatsApp (Gerente y Cliente) + voz.
- **F3:** más ERP, reportes programados/alertas, planes y cobro.

## 6. Pendientes de decisión del usuario
- Nombre comercial definitivo.
- Proveedor LLM y de voz (costos por empresa); recomendación: Claude para el agente.
- Para probar contra Odoo real: URL, base de datos y usuario/API key de sólo lectura de una instancia de prueba (p. ej. Odoo.sh o Odoo Online).
- Para WhatsApp (F2): cuenta Meta Business y número dedicado.
- Alojamiento: proyecto Supabase nuevo (el plan gratis ya tiene 2 proyectos; hay que pausar uno o subir de plan).

## 7. Estado F1 (2026-11-16)
- Hecho y probado: esquema + RLS (tests con PGlite), conector Odoo de sólo lectura (tests con Odoo simulado), herramientas con visibilidad por modo en código, agente, reportes PDF/Excel, panel, chat Gerente, widget web, Edge Function `api`.
- Decisión F1: conocimiento con búsqueda de texto completo de Postgres (español), sin embeddings (sin proveedor extra, determinístico). Se puede añadir pgvector después.
- Fuera de F1: caja/bancos, WhatsApp, voz.
- Supabase: proyecto `agente` (ref `lsbayfiblnylafyuxbeh`). Secretos de la función: `ANTHROPIC_API_KEY`, `ERP_ENC_KEY` (32 bytes base64). Opcional `ANTHROPIC_MODEL`.
- Límite conocido: el chequeo de dominio autorizado del widget usa el encabezado Origin (lo respetan los navegadores; un cliente no-navegador puede falsificarlo). Mitigación: límites de tasa y modo Cliente sin datos privados.
- Límite conocido: la descarga de páginas valida el host por nombre (no resuelve DNS); no cubre DNS rebinding.

## 8. Avance posterior (2026-11-17) — pendiente de desplegar
- Widget servido por la función: `GET {API}/widget.js` (única fuente `_shared/widget.ts`); el snippet del panel ya no depende de hospedaje aparte.
- WhatsApp (modo Gerente) por números autorizados: migración `0002_whatsapp.sql`, webhook `{API}/whatsapp` (verificación GET, firma HMAC `X-Hub-Signature-256`, deduplicación por `wamid`, texto y reportes como documento). NO probado contra Meta real. Secretos de la función: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; opcional `WHATSAPP_GRAPH_VERSION` (por defecto `v23.0`; confirmar en la documentación de Meta). El token por empresa se guarda cifrado desde el panel.
- Mensajes no autorizados reciben NO respuesta (no se confirma nada a desconocidos). Audios y otros tipos: respuesta fija de "sólo texto".
- Voz: sin proveedor de voz a texto aún; el teclado de Android ya dicta en la app.
- Para activar: aplicar `0002`, desplegar la función, crear la app en Meta (WhatsApp Cloud API), registrar el webhook y los dos secretos.
