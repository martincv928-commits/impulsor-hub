# AtalaIA · *Tu negocio, a la vista.*

Asistente de IA multiempresa que se conecta a **un ERP por empresa (sólo lectura)** y funciona en dos modos:

| | **Gerente** (interno) | **Cliente** (sitio web) |
|---|---|---|
| Quién | Dueño y gerentes con cuenta | Visitantes anónimos |
| Dónde | App (APK/PWA) y WhatsApp | Widget de chat en el sitio |
| Datos | ERP (ventas, cobranza, inventario, clientes) + reportes PDF/Excel | Sólo conocimiento público y, si se activa, catálogo publicado |

Especificación: [`docs/SPEC.md`](docs/SPEC.md) · Reglas de trabajo: [`CLAUDE.md`](CLAUDE.md).

## Garantías (cubiertas por pruebas)
- **Sólo lectura:** el conector Odoo tiene lista blanca de métodos; no existe forma de escribir.
- **Aislamiento:** RLS por empresa; el modo Cliente nunca recibe herramientas privadas (se decide en código, no en el prompt).
- **Cifras trazables:** salen de herramientas del ERP (Decimal, sin mezclar monedas); cada consulta queda en `tool_calls`.
- **Credenciales:** la API key del ERP y el token de WhatsApp se guardan cifrados (AES-GCM) y ningún cliente puede leerlos.

## Estructura
```
src/                       App React (login, chat, configuración)
supabase/migrations/       Esquema (0001 base, 0002/0004 WhatsApp, 0003 búsqueda de conocimiento, 0005 uso y topes)
supabase/functions/api/    Edge Function única (chat, ERP, conocimiento, WhatsApp, widget.js)
supabase/functions/_shared/ Núcleo testeable (agente, Odoo, reportes, WhatsApp…)
brand/  scripts/  resources/  Logo (SVG), generador de íconos, íconos Android
tests/                     vitest (+ PGlite para las migraciones reales)
signing/                   Llave de PRUEBAS pública (APK instalable sobre el anterior)
```

## Comandos
```bash
npm ci
npm test            # 75+ pruebas: BD/RLS, conector, modos, reportes, WhatsApp
npm run build       # tipos + build web
npm run icons       # regenera íconos PNG desde brand/*.svg (requiere playwright)
```

## Backend (Supabase `agente`, ref `lsbayfiblnylafyuxbeh`)
1. Migraciones en orden (`supabase/migrations/`).
2. Desplegar la función `api` (`supabase/functions/api` + `_shared` + `deno.json`), con `verify_jwt` desactivado: autentica por dentro.
3. Secretos de la función: `ANTHROPIC_API_KEY` (obligatorio). Opcionales: `ANTHROPIC_MODEL` (por defecto `claude-haiku-5-5`), `ERP_ENC_KEY` (32 bytes base64; si falta se deriva de la service key), y para WhatsApp `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION`.
4. En el frontend sólo van la URL y la *publishable key* (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Nunca `service_role`.

## Entrega (APK)
Al fusionar a `master` con cambios en `agente/`, el workflow **ATALAIA APK** corre pruebas, compila y publica
`https://github.com/martincv928-commits/impulsor-hub/releases/download/agente-apk-latest/atalaya.apk`
(ID técnico `mx.impulsor.atalaya` y archivo `atalaya.apk` se conservan por continuidad; la app se llama AtalaIA; firma de pruebas fija: cada APK se instala sobre el anterior). Los PR corren **ATALAIA CI** (pruebas + build).
Para Google Play hay que crear una llave de subida aparte (fuera del repo).

## Modelo de IA y topes de uso por empresa
- Modelo por defecto: `claude-haiku-5-5` (`DEFAULT_MODEL` en `_shared/llm.ts`); se cambia sin código con el secreto `ANTHROPIC_MODEL`.
- Cada llamada al modelo se registra en `usage_events` (tokens de entrada/salida, modo, canal, modelo). Se mide en **tokens, no en dinero**: el precio lo define el proveedor.
- Topes mensuales (UTC) **por empresa y por modo**: por defecto 3 000 000 tokens para la app gerencial y 1 000 000 para el chat del sitio (así un abuso del sitio no deja sin servicio al gerente). Al llegar al tope no se llama al modelo y se avisa.
- Sólo la plataforma fija topes (tabla `tenant_limits`, accesible con `service_role`); las empresas ven su consumo en Configuración → Uso. Ejemplo para ampliar el tope de una empresa:
  `insert into tenant_limits(tenant_id, gerente_monthly_tokens) values ('<id>', 10000000) on conflict (tenant_id) do update set gerente_monthly_tokens = excluded.gerente_monthly_tokens;`
- Migración: `0005_usage.sql`. Los valores por defecto viven en la función SQL `usage_check` (única fuente).

## Chat en un sitio web
En la app: Configuración → Sitio web → autorizar dominio → copiar el `<script>` (apunta a `…/functions/v1/api/widget.js`).

## WhatsApp (apagado por defecto)
El código y las pruebas existen, pero la pestaña está oculta (`VITE_FEATURE_WHATSAPP=1` la enciende) hasta activarlo:
1. Aplicar `0002_whatsapp.sql` y `0004_whatsapp_channels.sql` (esta última borra/recrea dos restricciones: Supabase pide confirmación).
2. Crear la app de WhatsApp Cloud API en Meta; registrar el webhook `…/functions/v1/api/whatsapp`.
3. Secretos de la función: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (y confirmar `WHATSAPP_GRAPH_VERSION`).
4. Reconstruir la app con `VITE_FEATURE_WHATSAPP=1` y probar con un número real.

## Límites conocidos
- El conector Odoo sólo se ha probado con datos simulados; falta una instancia real.
- WhatsApp no se ha probado con Meta real. Audios no soportados.
- El dominio autorizado del widget se valida por `Origin` (un cliente que no sea navegador puede falsificarlo); por eso el modo Cliente no toca datos privados y tiene límites de uso.
- El nombre **AtalaIA** no tiene verificación de disponibilidad comercial.
