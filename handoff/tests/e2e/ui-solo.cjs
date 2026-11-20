// Interfaz REAL, equipo de UNA persona: crear empresa, configurar, entregar turno y recibirlo uno mismo.
// Uso: igual que ui.cjs (vite preview en :4175 con VITE_SUPABASE_* reales).
const { chromium } = require('playwright');
const SB = 'hppzsirfbvvwgdlhhhvt.supabase.co', APP = process.env.APP_URL ?? 'http://localhost:4175/', OUT = process.env.OUT ?? '/tmp';
let fails = 0; const ok = (n, v) => { if (!v) fails++; console.log(v ? '✓' : '✗ FALLO', n); };
(async () => {
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    await pg.route(`**://${SB}/**`, async (route) => {
      const r = route.request();
      try {
        const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() });
        const h = Object.fromEntries(res.headers); delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding'];
        await route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) });
      } catch { await route.abort(); }
    });
    const tab = (t) => pg.locator(`nav.tabs button:has-text("${t}")`).click();
    await pg.goto(APP); await pg.getByText('No tengo cuenta').click();
    await pg.getByPlaceholder('tu@empresa.com').fill(`hf.e2e.${Date.now()}.solo@example.com`); await pg.locator('input[type=password]').fill('Prueba-12345');
    await pg.getByRole('button', { name: 'Crear cuenta' }).click(); await pg.getByText('Tu nombre').waitFor({ timeout: 20000 });
    await pg.getByLabel('Tu nombre').fill('Dueño Solo'); await pg.getByLabel('Nombre de la empresa').fill('E2E Negocio de Uno'); await pg.getByRole('button', { name: /Crear empresa/ }).click();
    await pg.getByRole('button', { name: 'Continuar configuración' }).click();
    await pg.getByPlaceholder('Nueva sede').fill('Local'); await pg.getByRole('button', { name: 'Agregar sede' }).click(); await pg.getByText('Local').first().waitFor();
    await pg.locator('.card:has(h3:text("Áreas")) select').selectOption({ label: 'Local' }); await pg.getByPlaceholder('Nueva área').fill('Caja'); await pg.getByRole('button', { name: 'Agregar área' }).click(); await pg.getByText('Caja').first().waitFor();
    await pg.getByPlaceholder('Nuevo turno (ej. Matutino)').fill('Día'); await pg.getByRole('button', { name: 'Agregar turno' }).click(); await pg.getByText('Día').first().waitFor();
    await tab('Entregar'); await pg.locator('.card:has(h3:text("Nueva entrega")) select').nth(3).selectOption({ label: 'SEGURIDAD' });
    await pg.getByRole('button', { name: 'Comenzar entrega' }).click(); await pg.getByText('ENTREGAR TURNO').waitFor();
    await pg.locator('textarea').first().fill('Sin novedades en el turno'); await pg.waitForFunction(() => document.body.innerText.includes('Guardado en el servidor'), null, { timeout: 15000 });
    await pg.getByRole('button', { name: 'ENTREGAR TURNO' }).click(); await pg.getByText('Turno entregado').waitFor({ timeout: 20000 }); ok('entrega enviada por la única persona', true);
    await pg.getByRole('button', { name: 'Listo' }).click(); await pg.getByText('Hola,').waitFor({ timeout: 15000 });
    ok('la barra muestra 1 turno por recibir (la propia entrega)', (await pg.locator('nav.tabs .dot').innerText()) === '1');
    await tab('Recibir'); ok('aviso de equipo de una persona visible', await pg.getByText('única persona').first().isVisible());
    await pg.screenshot({ path: `${OUT}/solo-1-recibir.png` });
    await pg.getByText('Almacén · Matutino').or(pg.getByText('Caja · Día')).first().click(); await pg.getByText('Tu decisión').waitFor();
    await pg.getByRole('button', { name: 'ACEPTAR ENTREGA' }).click(); await pg.getByText('Recepción propia').waitFor({ timeout: 20000 });
    ok('recepción propia registrada y marcada', true); await pg.screenshot({ path: `${OUT}/solo-2-aceptada.png` });
    ok('sin errores de JavaScript', errs.length === 0); if (errs.length) console.log(errs.slice(0, 3));
  } catch (e) { fails++; console.log('ERROR:', e.message.split('\n')[0]); }
  await b.close(); console.log(fails ? `\n${fails} FALLO(S)` : '\nTODO OK'); process.exit(fails ? 1 : 0);
})();
