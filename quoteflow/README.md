# QuoteFlow V0.1

PWA móvil sin backend ni IA: voz del dispositivo → texto → parser local → editor → PDF → compartir.
Todo se guarda en el dispositivo (localStorage).

## Probar
- En el teléfono: abre la URL publicada (ver abajo) en Chrome (Android) o Safari (iOS). Opcional: "Agregar a pantalla de inicio".
- Local: `cd quoteflow && npm start` y abre http://localhost:5173 (el dictado requiere https o localhost).
- Pruebas del parser/cálculos: `cd quoteflow && npm test`.

URL de prueba (sirve este directorio desde la rama):
https://raw.githack.com/martincv928-commits/impulsor-hub/claude/quoteflow-mvp-mobile-n14u6f/quoteflow/index.html

## Arquitectura (`src/`)
| Módulo | Responsabilidad |
|---|---|
| `interpreter.js` | Contrato `QuoteInterpreter` + `LocalQuoteInterpreter` (punto de extensión para un futuro `AIQuoteInterpreter`, no implementado) |
| `parser.js` | Reglas/regex para español MX: cliente, conceptos, cantidad, unidad, precio, descuento, IVA, vigencia, notas, confianza |
| `money.js` | Cálculos en enteros (centavos, milésimas, puntos base) |
| `catalog.js` | Memoria de productos/últimos precios y búsqueda con ambigüedad |
| `storage.js` | Persistencia local |
| `pdf.js` | PDF con jsPDF (vendorizado en `vendor/`) |
| `voice.js` | Web Speech API (es-MX) |
| `share.js` | Web Share API con archivo; descarga si no está disponible |
| `app.js` | UI |
