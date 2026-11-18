// Prueba de la INTERFAZ REAL contra el servidor real: dos usuarios, empresa, entrega, recepción y resolución.
// Uso (sandbox): vite build con VITE_SUPABASE_* reales; vite preview --port 4175;
//   NODE_PATH=$(npm root -g) NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node tests/e2e/ui.cjs
// Las peticiones a Supabase se reenvían con el fetch de Node (respeta el proxy y la verificación TLS).
const { chromium } = require('playwright');
const SB = 'hppzsirfbvvwgdlhhhvt.supabase.co', APP = process.env.APP_URL ?? 'http://localhost:4175/', OUT = process.env.OUT ?? '/tmp';
const stamp = Date.now(); let fails = 0;
const ok = (n, v) => { if (!v) fails++; console.log(v ? '✓' : '✗ FALLO', n); };
async function newPage(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', (e) => pg.errs.push(e.message));
  await pg.route(`**://${SB}/**`, async (route) => {
    const r = route.request();
    try {
      const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() });
      const h = Object.fromEntries(res.headers); delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding'];
      await route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) });
    } catch (e) { await route.abort(); }
  });
  return pg;
}
const shot = (pg, n) => pg.screenshot({ path: `${OUT}/ui-${n}.png` });
const tab = (pg, t) => pg.locator(`nav.tabs button:has-text("${t}")`).click();
async function signup(pg, tag) {
  await pg.goto(APP); await pg.getByText('No tengo cuenta').click();
  await pg.getByPlaceholder('tu@empresa.com').fill(`hf.e2e.${stamp}.${tag}@example.com`);
  await pg.locator('input[type=password]').fill('Prueba-12345'); await pg.getByRole('button', { name: 'Crear cuenta' }).click();
  await pg.getByText('Tu nombre').waitFor({ timeout: 20000 });
}
(async () => {
  const b = await chromium.launch();
  try {
    // ── Usuario A: administra y entrega
    const A = await newPage(b);
    await signup(A, 'ua'); ok('registro real desde la interfaz', true);
    await shot(A, '1-onboarding');
    await A.getByLabel('Tu nombre').fill('Martín Admin'); await A.getByLabel('Nombre de la empresa').fill('E2E UI Distribuidora');
    await A.getByRole('button', { name: /Crear empresa/ }).click();
    await A.getByText('Configura HANDOFF en 4 pasos').waitFor({ timeout: 20000 }); ok('empresa creada y guía de configuración visible', true);
    await shot(A, '2-inicio-guia');
    await A.getByRole('button', { name: 'Continuar configuración' }).click();
    await A.getByPlaceholder('Nueva sede').fill('Planta Norte'); await A.getByRole('button', { name: 'Agregar sede' }).click(); await A.getByText('Planta Norte').first().waitFor();
    await A.locator('.card:has(h3:text("Áreas")) select').selectOption({ label: 'Planta Norte' });
    await A.getByPlaceholder('Nueva área').fill('Almacén'); await A.getByRole('button', { name: 'Agregar área' }).click(); await A.getByText('Almacén').first().waitFor();
    await A.getByPlaceholder('Nuevo turno (ej. Matutino)').fill('Matutino'); await A.getByRole('button', { name: 'Agregar turno' }).click(); await A.getByText('Matutino').first().waitFor();
    ok('sede, área y turno creados', true);
    await shot(A, '3-estructura');
    await A.locator('.chips button:has-text("Equipo")').click(); await A.getByRole('button', { name: 'Generar código' }).click();
    const codeEl = A.locator('.item b').filter({ hasText: /^[A-Z0-9]{8}$/ }).first(); await codeEl.waitFor({ timeout: 15000 }); const code = (await codeEl.innerText()).trim();
    ok('código de invitación generado: ' + code, /^[A-Z0-9]{8}$/.test(code));
    await tab(A, 'Entregar');
    await A.locator('.card:has(h3:text("Nueva entrega")) select').nth(3).selectOption({ label: 'ALMACÉN' });
    await A.getByRole('button', { name: 'Comenzar entrega' }).click(); await A.getByText('ENTREGAR TURNO').waitFor();
    ok('botón de enviar bloqueado hasta llenar lo obligatorio', await A.getByRole('button', { name: 'ENTREGAR TURNO' }).isDisabled());
    await A.locator('select').first().selectOption('Ordenada'); await A.locator('.seg button:has-text("No")').click();
    await A.getByRole('button', { name: /Agregar pendiente/ }).click(); await A.getByLabel('Título').fill('Montacargas 2 no enciende');
    await A.locator('select').nth(1).selectOption('critical').catch(() => {});
    await A.getByRole('button', { name: 'Guardar pendiente' }).click(); await A.getByText('Montacargas 2 no enciende').waitFor();
    await shot(A, '4-entrega-llena');
    await A.waitForFunction(() => document.body.innerText.includes('Guardado en el servidor'), null, { timeout: 15000 });
    ok('borrador guardado en el servidor', true);
    ok('botón de enviar habilitado al completar', await A.getByRole('button', { name: 'ENTREGAR TURNO' }).isEnabled());
    await A.getByRole('button', { name: 'ENTREGAR TURNO' }).click(); await A.getByText('Turno entregado').waitFor({ timeout: 20000 });
    ok('turno entregado (confirmado por el servidor)', true); await shot(A, '5-entregado');
    // ── Usuario B: recibe
    const B = await newPage(b);
    await signup(B, 'ub');
    await B.getByLabel('Tu nombre').fill('Lucía Receptora'); await B.getByLabel('Código de invitación').fill(code); await B.getByRole('button', { name: 'Unirme' }).click();
    await B.getByText('Hola, Lucía').waitFor({ timeout: 20000 }); ok('segundo usuario se une con el código', true);
    ok('la barra muestra 1 turno por recibir', (await B.locator('nav.tabs .dot').innerText()) === '1');
    await tab(B, 'Recibir'); await B.getByText('Almacén · Matutino').click(); await B.getByText('Tu decisión').waitFor(); await shot(B, '6-recibir');
    ok('detalle muestra el pendiente reportado', await B.getByText('Montacargas 2 no enciende').first().isVisible());
    await B.getByLabel('Observaciones').fill('Revisar el montacargas antes del turno de la tarde');
    await B.getByRole('button', { name: 'ACEPTAR CON OBSERVACIONES' }).click(); await B.getByText('Aceptada con observaciones').first().waitFor({ timeout: 20000 });
    ok('recepción con observaciones registrada', true);
    await tab(B, 'Pendientes'); await B.getByText('Montacargas 2 no enciende').click(); await B.getByText('Cadena de responsabilidad').waitFor();
    ok('recibir NO asignó responsable', await B.getByText('SIN RESPONSABLE').first().isVisible());
    await B.getByRole('button', { name: /Asumir responsabilidad/ }).click(); await B.getByText('Asumió responsabilidad').waitFor({ timeout: 15000 });
    await B.getByLabel(/Nota/).fill('Se cambió la batería'); await B.getByRole('button', { name: /Marcar RESUELTO/ }).click(); await B.getByText('Resuelto por Lucía Receptora').waitFor({ timeout: 15000 });
    ok('pendiente resuelto con actor y hora', true); await shot(B, '7-resuelto');
    // ── A ve el resultado en Supervisor
    await A.reload(); await A.getByText('Hola, Martín').waitFor({ timeout: 20000 }); await tab(A, 'Más'); await A.getByText('Supervisor').first().click();
    await A.getByText('Entregas sin aceptar').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    await A.getByText('Turnos').first().waitFor(); await shot(A, '8-supervisor');
    ok('supervisor muestra 1 turno recibido', (await A.locator('.stat:has-text("Recibidos") b').innerText()) === '1');
    // ── botón atrás de Android
    await A.goBack(); ok('botón atrás regresa a Más (no cierra la app)', await A.getByText('Historial de entregas').isVisible());
    const errs = [...A.errs, ...B.errs]; ok('sin errores de JavaScript en toda la prueba', errs.length === 0); if (errs.length) console.log(errs.slice(0, 3));
  } catch (e) { fails++; console.log('ERROR:', e.message.split('\n')[0]); }
  await b.close(); console.log(fails ? `\n${fails} FALLO(S)` : '\nTODO OK'); process.exit(fails ? 1 : 0);
})();
