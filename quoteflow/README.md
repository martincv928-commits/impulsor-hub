# Cotízame (antes QuoteFlow)

Cotizaciones por voz o texto y seguimiento de cobranza para negocios pequeños en México.
Voz del dispositivo → texto → intérprete local → editor → PDF → compartir, más pagos,
parcialidades, clientes, reportes y soporte. Funciona en el navegador (PWA), como app
Android (Capacitor) y guarda en la nube (Supabase) con copia local para trabajar sin internet.

## Partes del proyecto
| Carpeta | Qué es |
|---|---|
| `quoteflow/` | App web de clientes (PWA). Sitio: `https://martincv928-commits.github.io/impulsor-hub/quoteflow/` |
| `quoteflow/admin/` | Panel de administración "Cotízame Admin" (soporte, planes, negocios). Solo para el dueño de la plataforma |
| `quoteflow-android/` | Empaque nativo (Capacitor) de la app de clientes → `.aab` para Google Play y `.apk` |
| `quoteflow-admin-android/` | Empaque nativo de Cotízame Admin → `.apk` |
| `cotizame-landing/` | Página de presentación (publicada en `/cotizame/`) |
| `quoteflow/supabase/` | Esquemas SQL de referencia (la base real vive en Supabase) |

## Probar
- Local: `cd quoteflow && npm start` y abre http://localhost:5173 (el dictado requiere https o localhost).
- Pruebas: `cd quoteflow && npm test` (parser, cálculos y pruebas de empaque/publicación).

## Arquitectura (`quoteflow/src/`)
| Módulo | Responsabilidad |
|---|---|
| `interpreter.js` | Contrato `QuoteInterpreter` + `LocalQuoteInterpreter` |
| `parser.js` | Reglas/regex para español MX: cliente, conceptos, cantidad, unidad, precio, descuento, IVA, vigencia, notas, confianza |
| `money.js` | Cálculos en enteros (centavos, milésimas, puntos base) |
| `catalog.js` | Memoria de productos/últimos precios y búsqueda con ambigüedad |
| `storage.js` | Persistencia local (localStorage) |
| `cloud.js` | Supabase: sesión, negocio, datos, soporte, planes |
| `pdf.js` | PDF con jsPDF (vendorizado en `vendor/`) |
| `voice.js` | Web Speech API en el navegador; reconocimiento nativo de Android en la app |
| `share.js` | Web Share / descarga en el navegador; Share, Filesystem y FileOpener en la app |
| `app.js` | UI, planes (`hasFeature`), arranque sin internet |

## Planes
Los límites y funciones de cada plan viven en la tabla `plan_limits` (Gratis, Básico, Pro).
La app bloquea por plan: avisos de cobranza, exportar a CSV y reportes; la base de datos
aplica los límites de usuarios y de cotizaciones al mes.

## Publicar
- **Web:** copiar `quoteflow/` (sin `admin/`) a la rama `gh-pages`, carpeta `quoteflow/`. Subir `CACHE_NAME` en `sw.js` cuando cambie la lista de archivos.
- **Android:** `./build-www.sh && npx cap sync android` y compilar con `./gradlew bundleRelease` (o `assembleRelease`). La firma se lee de las variables `KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`; **la llave nunca va en el repositorio** (carpeta `keystore/` ignorada). Cada subida a Play consume un `versionCode`: subirlo siempre.

## Datos y seguridad
- Respaldo diario automático y papelera (esquema `cotizame_respaldo`): nada se pierde por un borrado.
- La eliminación de cuenta se solicita desde la app o `eliminar-cuenta.html` y se confirma por correo; no hay borrado automático.
- Políticas de seguridad (RLS) en todas las tablas; el panel de administración usa funciones que verifican que quien llama sea administrador.
