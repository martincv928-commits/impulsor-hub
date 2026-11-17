// Pruebas de "salida a producción": no verifican cálculos sino que el empaque
// y los archivos que se publican sigan consistentes entre sí. Cada una cubre
// una falla real que ya ocurrió (app en blanco sin internet, flecha atrás que
// cerraba la app, llave de firma en el repo, etc.).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const QF = path.join(__dirname, '..');
const ROOT = path.join(QF, '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('el service worker guarda TODOS los scripts de index.html (con su ?v=) para abrir sin internet', () => {
  const html = read(QF, 'index.html');
  const sw = read(QF, 'sw.js');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 10, 'index.html debería cargar los scripts de la app');
  for (const s of scripts) {
    assert.ok(sw.includes(`'${s}'`), `sw.js no precarga ${s}`);
  }
});

test('todos los archivos que index.html y sw.js mencionan existen', () => {
  const html = read(QF, 'index.html');
  const sw = read(QF, 'sw.js');
  const refs = new Set([
    ...[...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]),
    ...[...sw.matchAll(/^\s*'([^']+)',?$/gm)].map((m) => m[1].split('?')[0]),
  ]);
  for (const r of refs) {
    if (r === './') continue;
    assert.ok(fs.existsSync(path.join(QF, r)), `falta el archivo ${r}`);
  }
});

test('el arranque sin internet usa la copia local del negocio y se limpia al cerrar sesión', () => {
  const app = read(QF, 'src', 'app.js');
  assert.match(app, /qf_biz_cache/);
  assert.match(app, /removeItem\('qf_biz_cache'\)/, 'cerrar sesión debe borrar la copia local');
  assert.match(app, /cachedBusinessFor\(session\)/);
});

test('la flecha atrás nativa navega por pantalla y no depende de canGoBack', () => {
  const app = read(QF, 'src', 'app.js');
  const i = app.indexOf("addListener('backButton'");
  assert.ok(i > 0, 'falta el listener backButton');
  const bloque = app.slice(i, i + 700);
  assert.doesNotMatch(bloque, /canGoBack/);
  assert.match(bloque, /exitApp\(\)/);
});

test('Android 16: la app de clientes opta por el "atrás predictivo"', () => {
  const m = read(ROOT, 'quoteflow-android', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  assert.match(m, /android:enableOnBackInvokedCallback="true"/);
});

test('versiones de Android válidas y apps distintas para clientes y administración', () => {
  const g = read(ROOT, 'quoteflow-android', 'android', 'app', 'build.gradle');
  const a = read(ROOT, 'quoteflow-admin-android', 'android', 'app', 'build.gradle');
  const code = (s) => Number(s.match(/versionCode (\d+)/)[1]);
  assert.ok(code(g) >= 16, 'versionCode de clientes no debe bajar de 16 (ya se usaron 1 al 15)');
  assert.ok(code(a) >= 2, 'versionCode de administración no debe bajar de 2');
  assert.match(g, /applicationId "mx\.impulsorhub\.quoteflow"/);
  assert.match(a, /applicationId "mx\.impulsorhub\.quoteflow\.admin"/);
  assert.match(read(ROOT, 'quoteflow-admin-android', 'capacitor.config.json'), /"appName": "Cotízame Admin"/);
});

test('la app de clientes no empaqueta el panel de administración', () => {
  const s = read(ROOT, 'quoteflow-android', 'build-www.sh');
  assert.match(s, /admin\|supabase\|tests/);
});

test('ninguna llave de firma ni contraseña está versionada en git', () => {
  let tracked = '';
  try { tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { return; } // sin git (p. ej. copia suelta)
  assert.doesNotMatch(tracked, /\.(jks|keystore|p12)$/m);
  assert.doesNotMatch(tracked, /new-keystore-password/);
});

test('la política de privacidad enlaza la página de eliminar cuenta y esta existe', () => {
  assert.match(read(QF, 'privacy.html'), /eliminar-cuenta\.html/);
  assert.ok(fs.existsSync(path.join(QF, 'eliminar-cuenta.html')));
  assert.match(read(QF, 'eliminar-cuenta.html'), /Solicitar eliminación de mi cuenta/);
});

test('la app ofrece "Solicitar eliminación de mi cuenta" y no borra nada por sí sola', () => {
  const app = read(QF, 'src', 'app.js');
  assert.match(app, /request-account-deletion/);
  assert.match(app, /Solicitud de eliminación de cuenta/);
  assert.doesNotMatch(app, /auth\.admin\.deleteUser/);
});

test('cada función de plan declarada se usa para bloquear algo', () => {
  const app = read(QF, 'src', 'app.js');
  const bloque = app.match(/const FEATURE_LABELS = \{([\s\S]*?)\};/)[1];
  const claves = [...bloque.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(claves.sort(), ['export_csv', 'push', 'reports']);
  for (const k of claves) {
    assert.match(app, new RegExp(`hasFeature\\('${k}'\\)`), `ninguna acción revisa la función ${k}`);
  }
});

test('sin sesión en la nube o con planes sin cargar, todo queda disponible', () => {
  const app = read(QF, 'src', 'app.js');
  const f = app.match(/function hasFeature\(f\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(f, /!\(cloudOn && S\.cloudBusiness && S\.plans\)\) return true/);
});

test('el nombre visible de la app es Cotízame (no QuoteFlow)', () => {
  assert.match(read(QF, 'index.html'), /<title>[^<]*Cotízame/);
  assert.doesNotMatch(read(QF, 'manifest.webmanifest'), /"name":\s*"QuoteFlow/);
  assert.match(read(ROOT, 'quoteflow-android', 'capacitor.config.json'), /"appName": "Cotízame"/);
});
