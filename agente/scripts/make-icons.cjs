// Genera íconos PNG (PWA + Android) desde brand/*.svg con el Chromium de Playwright.
// Uso: node scripts/make-icons.cjs   (requiere `playwright`; se ejecuta a mano al cambiar la marca)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const logo = fs.readFileSync(path.join(root, 'brand/logo.svg'), 'utf8');
const fg = fs.readFileSync(path.join(root, 'brand/foreground.svg'), 'utf8');
const BG = '#0B5F58';
async function render(page, svg, size, { round = false, bg = null } = {}) {
  const css = `html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block;${round ? 'border-radius:50%;overflow:hidden' : ''};${bg ? `background:${bg}` : ''}}`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>${css}</style>${svg}`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ deviceScaleFactor: 1 });
  const out = (p, buf) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), buf); };
  // PWA
  out('public/icon-192.png', await render(page, logo, 192)); out('public/icon-512.png', await render(page, logo, 512));
  out('public/apple-touch-icon.png', await render(page, logo.replace('rx="112"', 'rx="0"'), 180));
  out('public/favicon-32.png', await render(page, logo, 32));
  // Android: legado (48dp) y primer plano adaptativo (108dp) por densidad
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = `resources/android/res/mipmap-${d}`;
    out(`${dir}/ic_launcher.png`, await render(page, logo, Math.round(48 * k)));
    out(`${dir}/ic_launcher_round.png`, await render(page, logo.replace('rx="112"', 'rx="0"'), Math.round(48 * k), { round: true }));
    out(`${dir}/ic_launcher_foreground.png`, await render(page, fg, Math.round(108 * k)));
  }
  out('resources/android/res/values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
  await b.close(); console.log('íconos generados');
})();
