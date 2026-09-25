/* UI de QuoteFlow. Solo presentación y flujo: el parser, cálculos, PDF,
 * persistencia, voz y compartir viven en sus propios módulos. */
(function () {
  'use strict';
  const { money: M, catalog: CAT, storage: DB, pdf: PDF, voice: VOICE, share: SHARE, cloud: CLOUD, parser: P } = window.QF;
  const interpreter = window.QF.getInterpreter();
  const app = document.getElementById('app');
  const cloudOn = CLOUD && CLOUD.enabled();

  const UNITS = ['pieza', 'servicio', 'litro', 'metro', 'm²', 'kg', 'caja', 'paquete', 'hora', 'juego', 'rollo', 'bolsa', 'galón', 'bulto', 'lote', 'día'];
  const EXAMPLE = 'Cotiza a Constructora López 5 cámaras a 1850 cada una, instalación 3500 y 100 metros de cable a 12.50, más IVA, vigencia 15 días.';

  const S = {
    view: 'home',
    quote: null,
    interp: null,
    settings: DB.getSettings(),
    catalog: DB.getCatalog(),
    writeOpen: false,
    showAll: false,
    confirmDelete: false,
    listening: null,
    pendingBackup: null,
    cloudSession: null,
    cloudBusiness: null,
    authMode: 'login',
    authBusy: false,
    tickets: [],
    activeTicket: null,
    ticketMessages: [],
  };

  /* ---------- utilidades ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (c) => M.format(c, S.settings.currency);
  const uid = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const icon = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>',
    cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v.01M18 14v.01"/></svg>',
  };

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }

  function go(view) {
    S.view = view;
    S.confirmDelete = false;
    render();
    window.scrollTo(0, 0);
    if (view === 'home' && cloudOn && S.cloudBusiness) {
      CLOUD.business
        .getMine()
        .then((biz) => {
          if (biz) S.cloudBusiness = biz;
          if (S.view === 'home') render();
        })
        .catch(() => {});
    }
  }

  const BLOCKED_STATUS = ['SUSPENDED', 'CANCELLED'];
  function isBusinessBlocked() {
    return cloudOn && S.cloudBusiness && BLOCKED_STATUS.includes(S.cloudBusiness.status);
  }

  function dateStr(ts) {
    return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function totalsOf(q) {
    return M.computeTotals(q);
  }

  /* ---------- seguimiento de pagos (V0.4) ---------- */
  const PAYMENT_METHOD_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', otro: 'Otro' };
  const PAYMENT_LABEL = { SIN_PAGO: 'Sin pago', PARCIAL: 'Pago parcial', PAGADO: 'Pagado' };
  const PAYMENT_PILL = { SIN_PAGO: 'draft', PARCIAL: 'info', PAGADO: 'done' };
  const paidCentsOf = (q) => (q.payments || []).reduce((s, p) => s + p.amountCents, 0);
  const balanceCentsOf = (q) => Math.max(0, totalsOf(q).total - paidCentsOf(q));
  function paymentStatusOf(q) {
    const total = totalsOf(q).total;
    const paid = paidCentsOf(q);
    if (paid <= 0) return 'SIN_PAGO';
    if (total > 0 && paid >= total) return 'PAGADO';
    return 'PARCIAL';
  }
  function savePaymentsChange(q) {
    q.updatedAt = Date.now();
    DB.saveQuote(q);
    syncQuoteToCloud(q, S.catalog);
  }

  /* ---------- cuenta / negocio (V0.3, solo si hay Supabase configurado) ---------- */

  function viewLoading() {
    return `<div class="hero"><p class="muted">Cargando…</p></div>`;
  }

  function viewAuth() {
    const login = S.authMode === 'login';
    return `
      <div class="hero" style="padding-top:14px">
        <div class="brand">QuoteFlow</div>
      </div>
      <form class="stack" id="auth-form">
        <h2 class="title">${login ? 'Inicia sesión' : 'Crea tu cuenta'}</h2>
        <div class="field"><label for="a-email">Correo</label><input id="a-email" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="a-pass">Contraseña</label><input id="a-pass" name="password" type="password" required minlength="6" autocomplete="${login ? 'current-password' : 'new-password'}"></div>
        <button class="btn primary block" type="submit" ${S.authBusy ? 'disabled' : ''}>${S.authBusy ? 'Un momento…' : login ? 'Entrar' : 'Crear cuenta'}</button>
        <button class="btn ghost block" type="button" data-act="auth-toggle">${login ? '¿No tienes cuenta? Créala' : '¿Ya tienes cuenta? Inicia sesión'}</button>
      </form>`;
  }

  function viewBusinessNew() {
    const s = S.settings; // se usan como sugerencia inicial si ya había datos locales de V0.2
    return `
      <div class="hero" style="padding-top:14px"><div class="brand">QuoteFlow</div></div>
      <form class="stack" id="business-form">
        <h2 class="title">Crea tu negocio</h2>
        <p class="hint">Todo lo que cotices va a quedar guardado en este negocio.</p>
        <div class="field"><label for="b-name">Nombre comercial</label><input id="b-name" name="name" required value="${esc(s.businessName)}"></div>
        <div class="field"><label for="b-phone">Teléfono</label><input id="b-phone" name="phone" type="tel" value="${esc(s.phone)}"></div>
        <div class="field"><label for="b-email">Correo</label><input id="b-email" name="email" type="email" value="${esc(s.email)}"></div>
        <div class="field"><label for="b-rfc">RFC (opcional)</label><input id="b-rfc" name="rfc" value="${esc(s.rfc)}" style="text-transform:uppercase"></div>
        <div class="two-col">
          <div class="field"><label for="b-cur">Moneda</label><select id="b-cur" name="currency">${['MXN', 'USD'].map((c) => `<option ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field"><label for="b-iva">IVA predeterminado %</label><input id="b-iva" name="ivaRate" inputmode="decimal" value="${esc(M.centsToStr(s.ivaRateBp).replace(/\.00$/, ''))}"></div>
        </div>
        <button class="btn primary block" type="submit" ${S.authBusy ? 'disabled' : ''}>${S.authBusy ? 'Creando…' : 'Crear negocio'}</button>
      </form>`;
  }

  function viewImportPrompt() {
    const n = DB.getQuotes().length;
    const p = DB.getCatalog().length;
    return `
      <div class="hero" style="padding-top:14px"><div class="brand">QuoteFlow</div></div>
      <div class="stack">
        <p>Encontramos datos de QuoteFlow en este dispositivo: ${n} cotización(es) y ${p} producto(s) de catálogo.</p>
        <button class="btn primary block" data-act="import-yes" ${S.authBusy ? 'disabled' : ''}>Importarlos a mi cuenta</button>
        <button class="btn block" data-act="import-no" ${S.authBusy ? 'disabled' : ''}>Conservar solo localmente</button>
      </div>`;
  }

  async function afterLogin() {
    S.cloudBusiness = await CLOUD.business.getMine();
    if (!S.cloudBusiness) return go('business-new');
    const hasLocal = DB.getQuotes().length > 0 || DB.getCatalog().length > 0;
    if (hasLocal && !DB.isImportDecided()) return go('import-prompt');
    await pullAndMerge();
    go('home');
  }

  async function pullAndMerge() {
    S.settings = DB.getSettings();
    DB.saveSettings(CLOUD.settingsFromBusinessRow(S.cloudBusiness, S.settings));
    S.settings = DB.getSettings();
    const { catalog, quotes } = await CLOUD.data.pull(S.cloudBusiness.id);
    DB.saveCatalog(catalog);
    S.catalog = catalog;
    quotes.forEach((q) => DB.saveQuote(q));
  }

  /* ---------- soporte (lado cliente) ---------- */
  function ticketStatusLabel(s) {
    return { OPEN: 'Abierto', IN_PROGRESS: 'En proceso', WAITING_CUSTOMER: 'Esperando tu respuesta', RESOLVED: 'Resuelto', CLOSED: 'Cerrado' }[s] || s;
  }
  const ticketDone = (t) => t.status === 'RESOLVED' || t.status === 'CLOSED';

  function viewSupportList() {
    return `
      <header class="top">
        <button class="icon-btn" data-act="settings" aria-label="Volver a configuración">${icon.back}</button>
        <div class="title">Soporte</div>
      </header>
      <div class="stack">
        <button class="btn primary block" data-act="support-new">+ Nueva solicitud</button>
        <div class="list">
          ${S.tickets.length ? S.tickets.map((t) => `
            <button class="qrow" data-act="support-open" data-id="${t.id}">
              <span class="client">${esc(t.subject)}</span>
              <span class="pill ${ticketDone(t) ? 'done' : 'draft'}">${ticketStatusLabel(t.status)}</span>
              <span class="meta">${dateStr(new Date(t.updated_at).getTime())}</span>
            </button>`).join('') : '<div class="empty">No has enviado ninguna solicitud de soporte.</div>'}
        </div>
      </div>`;
  }

  function viewSupportNew() {
    return `
      <header class="top">
        <button class="icon-btn" data-act="support-home" aria-label="Volver a soporte">${icon.back}</button>
        <div class="title">Nueva solicitud</div>
      </header>
      <form class="stack" id="support-new-form">
        <div class="field"><label for="t-subject">Asunto</label><input id="t-subject" name="subject" required></div>
        <div class="field"><label for="t-desc">Cuéntanos qué pasa</label><textarea id="t-desc" name="description" required style="min-height:120px"></textarea></div>
        <button class="btn primary block" type="submit">Enviar</button>
      </form>`;
  }

  function viewSupportTicket() {
    const t = S.activeTicket;
    return `
      <header class="top">
        <button class="icon-btn" data-act="support-home" aria-label="Volver a soporte">${icon.back}</button>
        <div class="title">${esc(t.subject)}</div>
        <span class="spacer"></span>
        <span class="pill ${ticketDone(t) ? 'done' : 'draft'}">${ticketStatusLabel(t.status)}</span>
      </header>
      <div class="stack">
        ${S.ticketMessages.map((m) => `
          <div class="card">
            <span class="tag ${m.author_role === 'admin' ? '' : 'warn'}">${m.author_role === 'admin' ? 'Soporte QuoteFlow' : 'Tú'}</span>
            <div>${esc(m.body).replace(/\n/g, '<br>')}</div>
            <span class="hint" style="font-size:11px">${dateStr(new Date(m.created_at).getTime())}</span>
          </div>`).join('')}
        ${ticketDone(t) ? '' : `
          <form class="stack" id="support-reply-form">
            <textarea id="t-reply" name="body" placeholder="Escribe tu respuesta" required style="min-height:80px"></textarea>
            <button class="btn primary block" type="submit">Enviar</button>
          </form>`}
      </div>`;
  }

  async function openSupportHome() {
    try {
      S.tickets = await CLOUD.support.list(S.cloudBusiness.id);
    } catch (e) {
      toast(e.message);
      S.tickets = S.tickets || [];
    }
    go('support-list');
  }

  async function openSupportTicket(id) {
    S.activeTicket = S.tickets.find((t) => t.id === id);
    try {
      S.ticketMessages = await CLOUD.support.messages(id);
    } catch (e) {
      toast(e.message);
      S.ticketMessages = [];
    }
    go('support-ticket');
  }

  /* ---------- inicio ---------- */
  function viewHome() {
    const quotes = DB.getQuotes();
    const shown = S.showAll ? quotes : quotes.slice(0, 12);
    const name = S.settings.businessName;
    return `
      <header class="top">
        <div class="brand">QuoteFlow${name ? `<small>${esc(name)}</small>` : ''}</div>
        <span class="spacer"></span>
        <button class="icon-btn" data-act="collections" aria-label="Cobranza">${icon.cash}</button>
        <button class="icon-btn" data-act="settings" aria-label="Configuración del negocio">${icon.gear}</button>
      </header>
      ${!name ? `<button class="example" data-act="settings">Configura el nombre y datos de tu negocio para que aparezcan en el PDF. <b>Configurar</b></button>` : ''}
      ${isBusinessBlocked() ? `
        <div class="banner baja">
          <div class="head">! Negocio ${S.cloudBusiness.status === 'CANCELLED' ? 'cancelado' : 'suspendido'}</div>
          <p style="margin:0">No puedes crear cotizaciones nuevas mientras esto siga así. Contacta a soporte desde Configuración si crees que es un error.</p>
        </div>` : `
      <section class="hero">
        <button class="mic" data-act="speak" aria-label="Hablar cotización">${icon.mic}</button>
        <div class="mic-label">Hablar</div>
        <p>Di algo como: “Cotiza a Pedro 20 litros de jabón a 14 pesos, más IVA”.</p>
      </section>
      <section class="write">
        ${S.writeOpen ? `
          <label class="lbl" for="free-text">Escribe la cotización</label>
          <textarea id="free-text" placeholder="${esc(EXAMPLE)}"></textarea>
          <div class="row">
            <button class="btn ghost" data-act="fill-example">Usar ejemplo</button>
            <span class="spacer"></span>
            <button class="btn primary" data-act="interpret">Interpretar</button>
          </div>` : `<button class="btn block" data-act="write">${icon.pen} Escribir cotización</button>`}
      </section>`}
      <div class="section-h"><h2>Cotizaciones recientes</h2>${quotes.length > 12 ? `<button class="btn ghost" data-act="toggle-all">${S.showAll ? 'Ver menos' : 'Ver todas'}</button>` : ''}</div>
      <div class="list">
        ${shown.length ? shown.map((q) => `
          <button class="qrow" data-act="open" data-id="${q.id}">
            <span class="client">${esc(q.client || 'Sin cliente')}</span>
            <span class="total num">${fmt(totalsOf(q).total)}</span>
            <span class="meta"><span class="mono">${esc(q.folio || '—')}</span> · ${dateStr(q.updatedAt)}</span>
            <span style="display:flex;gap:6px;justify-self:end">
              <span class="pill ${q.status === 'GENERADA' ? 'done' : 'draft'}">${q.status}</span>
              ${q.status === 'GENERADA' ? `<span class="pill ${PAYMENT_PILL[paymentStatusOf(q)]}">${PAYMENT_LABEL[paymentStatusOf(q)]}</span>` : ''}
            </span>
          </button>`).join('') : `<div class="empty">Aún no hay cotizaciones. Toca <b>Hablar</b> o <b>Escribir</b> para crear la primera.</div>`}
      </div>`;
  }

  /* ---------- voz ---------- */
  // Overlay de dictado genérico: muestra "Escuchando…", entrega el texto final
  // a onFinish. Lo usan tanto la cotización por voz como el pago por voz.
  function dictate(onFinish, onErrorFallback) {
    const overlay = document.createElement('div');
    overlay.className = 'listen';
    overlay.innerHTML = `
      <div class="row"><span class="pulse"></span><b>Escuchando…</b></div>
      <div class="transcript empty-t" id="tr">Habla con naturalidad. Toca “Listo” al terminar.</div>
      <div class="row"><button class="btn" id="v-cancel">Cancelar</button><span class="spacer"></span><button class="btn primary" id="v-done">Listo</button></div>`;
    document.body.appendChild(overlay);
    const tr = overlay.querySelector('#tr');
    let last = '';
    let cancelled = false;
    let handle;
    const close = () => { overlay.remove(); S.listening = null; };
    try {
      handle = S.listening = VOICE.start({
        onText: (t) => { last = t; tr.textContent = t; tr.classList.remove('empty-t'); },
        onEnd: (finalText) => {
          close();
          if (cancelled) return;
          onFinish((finalText || last).trim());
        },
        onError: (code) => {
          close();
          if (onErrorFallback) onErrorFallback(code);
          else toast(code === 'not-allowed' || code === 'service-not-allowed'
            ? 'Permite el micrófono para dictar.' : 'No se pudo usar el dictado (' + code + ').');
        },
      });
    } catch (e) {
      close();
      toast('No se pudo iniciar el dictado.');
      return;
    }
    overlay.querySelector('#v-done').onclick = () => handle && handle.stop();
    overlay.querySelector('#v-cancel').onclick = () => { cancelled = true; handle && handle.abort(); close(); };
  }

  function startVoice() {
    if (!VOICE.supported()) {
      S.writeOpen = true;
      render();
      document.getElementById('free-text').focus();
      toast('Este navegador no tiene dictado. Usa el micrófono de tu teclado.');
      return;
    }
    dictate(
      (text) => { if (text) interpretText(text); else toast('No se escuchó nada. Intenta de nuevo.'); },
      (code) => {
        S.writeOpen = true;
        render();
        toast(code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Permite el micrófono para dictar, o usa el micrófono del teclado.'
          : 'No se pudo usar el dictado (' + code + '). Escribe o usa el teclado.');
      }
    );
  }

  function startPaymentVoice() {
    if (!VOICE.supported()) return toast('Este navegador no tiene dictado. Escribe el monto directamente.');
    dictate((text) => {
      if (!text) return toast('No se escuchó nada.');
      const cents = P.parseAmount(text);
      const amountInput = document.getElementById('pay-amount');
      if (cents && amountInput) amountInput.value = M.centsToStr(cents).replace(/\.00$/, '');
      const methodSelect = document.getElementById('pay-method');
      const lower = text.toLowerCase();
      const foundMethod = Object.keys(PAYMENT_METHOD_LABEL).find((m) => lower.includes(m));
      if (foundMethod && methodSelect) methodSelect.value = foundMethod;
      toast(cents ? 'Monto capturado: revisa y toca “Registrar pago”.' : 'No se entendió un monto; escríbelo manualmente.');
    });
  }

  /* ---------- interpretación ---------- */
  async function interpretText(text, keep) {
    const res = await interpreter.interpret(text, { catalog: S.catalog, settings: S.settings });
    const now = Date.now();
    const base = keep || { id: uid(), folio: null, status: 'BORRADOR', createdAt: now, conditions: S.settings.conditions };
    S.quote = Object.assign({}, base, res.quote, { sourceText: text, updatedAt: now });
    if (keep && !res.quote.client) S.quote.client = keep.client;
    S.interp = res;
    S.writeOpen = false;
    go('editor');
  }

  /* ---------- editor ---------- */
  function itemMissing(it) {
    return { qty: it.qtyMilli === null || it.qtyMilli === undefined, price: it.priceCents === null || it.priceCents === undefined, desc: !String(it.desc || '').trim() };
  }

  function itemHtml(it) {
    const miss = itemMissing(it);
    const warn = miss.qty || miss.price || miss.desc || (it.candidates && it.candidates.length);
    const tag = it.priceSource === 'catalogo'
      ? `<span class="tag ${it.flags && it.flags.includes('precio_catalogo_aprox') ? 'warn' : ''}">Precio del catálogo${it.catalogName ? ': ' + esc(it.catalogName) : ''}</span>`
      : '';
    const amt = M.lineAmount(it);
    return `
      <div class="card item ${warn ? 'warn' : ''}" data-item="${it.id}">
        <div class="desc-row">
          <input id="d-${it.id}" data-k="desc" value="${esc(it.desc)}" placeholder="Concepto" list="cat-list" class="${miss.desc ? 'missing' : ''}" aria-label="Concepto">
          <button class="x-btn" data-act="del-item" data-id="${it.id}" aria-label="Eliminar concepto">×</button>
        </div>
        ${it.candidates && it.candidates.length ? `
          <div class="hint">¿Cuál producto? Coincide con varios del catálogo:</div>
          <div class="chips">${it.candidates.map((c, i) => `<button class="chip" data-act="pick" data-id="${it.id}" data-i="${i}">${esc(c.name)} · ${fmt(c.priceCents)}${c.unit ? '/' + esc(c.unit) : ''}</button>`).join('')}</div>` : ''}
        <div class="grid">
          <div><label for="q-${it.id}">Cantidad</label><input id="q-${it.id}" data-k="qty" inputmode="decimal" value="${esc(M.milliToStr(it.qtyMilli))}" placeholder="?" class="num ${miss.qty ? 'missing' : ''}"></div>
          <div><label for="u-${it.id}">Unidad</label><input id="u-${it.id}" data-k="unit" value="${esc(it.unit)}" list="unit-list" placeholder="pieza"></div>
          <div><label for="p-${it.id}">Precio unit.</label><input id="p-${it.id}" data-k="price" inputmode="decimal" value="${esc(M.centsToStr(it.priceCents))}" placeholder="$?" class="num ${miss.price ? 'missing' : ''}"></div>
        </div>
        <div class="foot"><span>${tag}</span><span class="amount num" id="amt-${it.id}">${amt === null ? '<span class="muted">Importe —</span>' : fmt(amt)}</span></div>
      </div>`;
  }

  function viewEditor() {
    const q = S.quote;
    const r = S.interp;
    const confLabel = { alta: 'Todo claro', media: 'Revisa lo marcado', baja: 'Faltan datos: complétalos' };
    const d = q.discount || { type: 'pct', value: 0 };
    return `
      <header class="top">
        <button class="icon-btn" data-act="home" aria-label="Volver al inicio">${icon.back}</button>
        <div class="title">${q.folio ? `<span class="mono">${esc(q.folio)}</span>` : 'Nueva cotización'}</div>
        <span class="spacer"></span>
        <span class="pill ${q.status === 'GENERADA' ? 'done' : 'draft'}">${q.status}</span>
      </header>
      <div class="stack">
        ${r ? `
          <div class="banner ${r.confidence}">
            <div class="head">${r.confidence === 'alta' ? '✓' : '!'} ${confLabel[r.confidence]}</div>
            ${r.doubtful.length || r.unparsed.length ? `<ul>${r.doubtful.map((x) => `<li>${esc(x.message)}</li>`).join('')}${r.unparsed.map((u) => `<li>No se entendió: “${esc(u)}”</li>`).join('')}</ul>` : ''}
            <details>
              <summary>Texto original</summary>
              <textarea id="src-text" style="margin-top:8px;min-height:80px">${esc(q.sourceText || '')}</textarea>
              <button class="btn" data-act="reinterpret" style="margin-top:8px">Volver a interpretar</button>
            </details>
          </div>` : ''}
        <div class="field"><label for="client">Cliente</label><input id="client" data-q="client" value="${esc(q.client)}" placeholder="Nombre del cliente" class="${q.client ? '' : 'missing'}"></div>
        <div>
          <div class="lbl">Conceptos</div>
          <div class="stack" id="items">${q.items.map(itemHtml).join('')}</div>
          <button class="btn block ghost" data-act="add-item" style="margin-top:10px">+ Agregar concepto</button>
        </div>
        <div class="field">
          <label>IVA</label>
          <div class="seg" role="group" aria-label="IVA">
            ${[['mas', 'Más IVA'], ['incluido', 'IVA incluido'], ['sin', 'Sin IVA']].map(([k, l]) => `<button data-act="iva" data-v="${k}" aria-pressed="${q.ivaMode === k}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="two-col">
          <div class="field"><label for="iva-rate">Tasa IVA %</label><input id="iva-rate" data-q="ivaRate" inputmode="decimal" class="num" value="${esc(M.centsToStr(q.ivaRateBp).replace(/\.00$/, ''))}"></div>
          <div class="field"><label for="validity">Vigencia (días)</label><input id="validity" data-q="validity" inputmode="numeric" class="num" value="${esc(q.validityDays)}"></div>
        </div>
        <div class="two-col">
          <div class="field"><label for="disc">Descuento</label><input id="disc" data-q="disc" inputmode="decimal" class="num" value="${d.value ? esc(M.centsToStr(d.value).replace(/\.00$/, '')) : ''}" placeholder="0"></div>
          <div class="field"><label>Tipo</label><div class="seg two" role="group" aria-label="Tipo de descuento">
            <button data-act="disc-type" data-v="pct" aria-pressed="${d.type !== 'amount'}">%</button>
            <button data-act="disc-type" data-v="amount" aria-pressed="${d.type === 'amount'}">$</button>
          </div></div>
        </div>
        <div class="field"><label for="notes">Notas</label><textarea id="notes" data-q="notes" style="min-height:64px" placeholder="Opcional">${esc(q.notes)}</textarea></div>
        <div class="field"><label for="conditions">Condiciones</label><textarea id="conditions" data-q="conditions" style="min-height:64px">${esc(q.conditions)}</textarea></div>
        ${q.folio ? (S.confirmDelete
          ? `<div class="confirm-row">¿Eliminar esta cotización? <button class="btn danger" data-act="delete-yes">Eliminar</button><button class="btn" data-act="delete-no">No</button></div>`
          : `<button class="btn ghost danger" data-act="delete">Eliminar cotización</button>`) : ''}
      </div>
      <datalist id="cat-list">${S.catalog.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <datalist id="unit-list">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
      <div class="dock"><div class="dock-in">
        <div class="totals num" id="totals">${totalsHtml()}</div>
        <div class="actions">
          <button class="btn" data-act="save">Guardar</button>
          <button class="btn primary" data-act="generate">Generar PDF</button>
        </div>
      </div></div>`;
  }

  function totalsHtml() {
    const q = S.quote;
    const t = totalsOf(q);
    const rate = M.centsToStr(q.ivaRateBp).replace(/\.00$/, '');
    let rows = `<span class="muted">Subtotal</span><span>${fmt(t.subtotal)}</span>`;
    if (t.discount) rows += `<span class="muted">Descuento</span><span>-${fmt(t.discount)}</span>`;
    if (q.ivaMode === 'mas') rows += `<span class="muted">IVA ${rate}%</span><span>${fmt(t.iva)}</span>`;
    if (q.ivaMode === 'incluido') rows += `<span class="muted">IVA ${rate}% incluido</span><span>${fmt(t.iva)}</span>`;
    rows += `<span class="t">TOTAL</span><span class="t">${fmt(t.total)}</span>`;
    if (t.incomplete) rows += `<span class="muted" style="grid-column:1/-1;font-size:12px">${t.incomplete} concepto(s) sin cantidad o precio no se suman.</span>`;
    return rows;
  }

  function refreshTotals() {
    const el = document.getElementById('totals');
    if (el) el.innerHTML = totalsHtml();
  }

  function findItem(id) {
    return S.quote.items.find((i) => i.id === id);
  }

  function applyCatalog(it) {
    const f = CAT.find(S.catalog, it.desc);
    if (f.match && (it.priceCents === null || it.priceCents === undefined)) {
      it.priceCents = f.match.priceCents;
      it.priceSource = 'catalogo';
      it.catalogName = f.match.name;
      it.flags = [f.exact ? 'precio_catalogo' : 'precio_catalogo_aprox'];
      if (f.match.unit) it.unit = f.match.unit;
      return true;
    }
    return false;
  }

  function onEditorInput(e) {
    const t = e.target;
    const q = S.quote;
    const card = t.closest('[data-item]');
    if (card && t.dataset.k) {
      const it = findItem(card.dataset.item);
      const k = t.dataset.k;
      if (k === 'desc') it.desc = t.value;
      if (k === 'unit') it.unit = t.value;
      if (k === 'qty') it.qtyMilli = M.toMilli(t.value);
      if (k === 'price') { it.priceCents = M.toCents(t.value); it.priceSource = 'manual'; }
      if (k === 'qty' || k === 'price') {
        t.classList.toggle('missing', (k === 'qty' ? it.qtyMilli : it.priceCents) === null);
        const amt = M.lineAmount(it);
        document.getElementById('amt-' + it.id).innerHTML = amt === null ? '<span class="muted">Importe —</span>' : fmt(amt);
      }
      refreshTotals();
      return;
    }
    const f = t.dataset.q;
    if (!f) return;
    if (f === 'client') { q.client = t.value; t.classList.toggle('missing', !t.value.trim()); }
    if (f === 'notes') q.notes = t.value;
    if (f === 'conditions') q.conditions = t.value;
    if (f === 'validity') q.validityDays = parseInt(t.value, 10) || 0;
    if (f === 'ivaRate') q.ivaRateBp = M.toBp(t.value) || 0;
    if (f === 'disc') q.discount = { type: (q.discount && q.discount.type) || 'pct', value: M.toCents(t.value) || 0 };
    refreshTotals();
  }

  function onEditorChange(e) {
    const t = e.target;
    const card = t.closest('[data-item]');
    if (card && t.dataset.k === 'desc') {
      const it = findItem(card.dataset.item);
      it.candidates = [];
      if (applyCatalog(it)) { render(); toast('Precio tomado del catálogo: ' + fmt(it.priceCents)); }
    }
  }

  function validate(q) {
    if (!q.items.length) return 'Agrega al menos un concepto.';
    const bad = q.items.filter((it) => { const m = itemMissing(it); return m.qty || m.price || m.desc; });
    if (bad.length) return 'Completa cantidad y precio de: ' + bad.map((b) => b.desc || 'concepto sin nombre').join(', ');
    if (!String(q.client || '').trim()) return 'Escribe el nombre del cliente.';
    return null;
  }

  function persist(status) {
    const q = S.quote;
    const now = Date.now();
    if (!q.folio) q.folio = DB.nextFolio();
    q.status = status;
    q.updatedAt = now;
    if (status === 'GENERADA') q.generatedAt = now;
    q.items.forEach((it) => { it.candidates = []; });
    q.totals = totalsOf(q);
    DB.saveQuote(q);
    let cat = S.catalog;
    q.items.forEach((it) => { cat = CAT.upsert(cat, it, now); });
    S.catalog = cat;
    DB.saveCatalog(cat);
    syncQuoteToCloud(q, cat);
  }

  // La cotización y el catálogo ya quedaron guardados localmente (arriba); esto
  // solo intenta ponerlos al día en la nube. Si falla, se avisa pero nada se pierde:
  // la copia local es la que ya se guardó y se puede reintentar más tarde.
  function syncQuoteToCloud(q, cat) {
    if (!(cloudOn && S.cloudBusiness)) return;
    const bizId = S.cloudBusiness.id;
    CLOUD.data
      .pushQuote(bizId, q)
      .then((cloudId) => {
        if (cloudId !== q.id) {
          DB.deleteQuote(q.id);
          q.id = cloudId;
          DB.saveQuote(q);
        }
      })
      .catch((e) => toast('Se guardó en este dispositivo, pero no se sincronizó con la nube: ' + e.message));
    q.items.forEach((it) => {
      const entry = cat.find((c) => c.key === CAT.key(it.desc));
      if (entry) CLOUD.data.pushProduct(bizId, entry).catch(() => {});
    });
  }

  /* ---------- resumen / compartir ---------- */
  function viewSummary() {
    const q = S.quote;
    const t = totalsOf(q);
    return `
      <header class="top">
        <button class="icon-btn" data-act="home" aria-label="Volver al inicio">${icon.back}</button>
        <div class="title mono">${esc(q.folio)}</div>
        <span class="spacer"></span>
        <span class="pill ${q.status === 'GENERADA' ? 'done' : 'draft'}">${q.status}</span>
      </header>
      <section class="summary">
        <div class="muted">${esc(q.client)}</div>
        <div class="big num">${fmt(t.total)}</div>
        <div class="muted" style="font-size:14px">${dateStr(q.generatedAt || q.updatedAt)} · vigencia ${esc(q.validityDays)} días</div>
      </section>
      <div class="stack">
        <button class="btn primary block" data-act="share">${icon.share} Compartir PDF</button>
        <div class="two-col">
          <button class="btn" data-act="view-pdf">Ver PDF</button>
          <button class="btn" data-act="download">Descargar</button>
        </div>
        <div class="sheet"><table class="num">
          ${q.items.map((it) => `<tr><td>${esc(M.milliToStr(it.qtyMilli))} ${esc(it.unit)} · ${esc(it.desc)}<div class="muted">${fmt(it.priceCents)} c/u</div></td><td class="r">${fmt(M.lineAmount(it))}</td></tr>`).join('')}
          <tr><td class="muted">Subtotal</td><td class="r">${fmt(t.subtotal)}</td></tr>
          ${t.discount ? `<tr><td class="muted">Descuento</td><td class="r">-${fmt(t.discount)}</td></tr>` : ''}
          ${q.ivaMode !== 'sin' ? `<tr><td class="muted">IVA${q.ivaMode === 'incluido' ? ' incluido' : ''}</td><td class="r">${fmt(t.iva)}</td></tr>` : ''}
          <tr><td><b>Total</b></td><td class="r"><b>${fmt(t.total)}</b></td></tr>
        </table></div>
        ${paymentsSection(q)}
        <div class="two-col">
          <button class="btn" data-act="edit">Editar</button>
          <button class="btn" data-act="new">Nueva cotización</button>
        </div>
      </div>`;
  }

  function paymentsSection(q) {
    const total = totalsOf(q).total;
    const paid = paidCentsOf(q);
    const balance = balanceCentsOf(q);
    const status = paymentStatusOf(q);
    const payments = q.payments || [];
    return `
      <div class="section-h"><h2>Cobro</h2><span class="pill ${PAYMENT_PILL[status]}">${PAYMENT_LABEL[status]}</span></div>
      <div class="sheet"><table class="num">
        <tr><td class="muted">Pagado</td><td class="r">${fmt(paid)}</td></tr>
        <tr><td><b>Saldo</b></td><td class="r"><b>${fmt(balance)}</b></td></tr>
      </table></div>
      ${payments.length ? `<div class="list">${payments.map((p) => `
        <div class="qrow" style="grid-template-columns:1fr auto">
          <span class="client">${fmt(p.amountCents)} · ${esc(PAYMENT_METHOD_LABEL[p.method] || p.method)}${p.note ? ' · ' + esc(p.note) : ''}</span>
          <button class="x-btn" data-act="del-payment" data-id="${p.id}" aria-label="Eliminar pago">×</button>
          <span class="meta">${dateStr(p.paidAt)}</span>
        </div>`).join('')}</div>` : ''}
      ${balance > 0 ? `
        <form class="stack" id="payment-form">
          <div class="two-col">
            <div class="field">
              <label for="pay-amount">Monto recibido</label>
              <div class="row">
                <input id="pay-amount" name="amount" inputmode="decimal" class="num" value="${esc(M.centsToStr(balance).replace(/\.00$/, ''))}" required style="flex:1">
                <button type="button" class="icon-btn" data-act="pay-voice" aria-label="Dictar monto">${icon.mic}</button>
              </div>
            </div>
            <div class="field"><label for="pay-method">Método</label><select id="pay-method" name="method">${Object.keys(PAYMENT_METHOD_LABEL).map((m) => `<option value="${m}">${PAYMENT_METHOD_LABEL[m]}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label for="pay-note">Nota (opcional)</label><input id="pay-note" name="note"></div>
          <button class="btn primary block" type="submit">Registrar pago</button>
        </form>` : ''}
      <div class="two-col" style="margin-top:4px">
        <button class="btn" data-act="share-receipt">${icon.share} Compartir estado de cuenta</button>
        <button class="btn" data-act="download-receipt">Descargar</button>
      </div>`;
  }

  /* ---------- cobranza: saldos pendientes de cobro ---------- */
  function viewCollections() {
    const pending = DB.getQuotes()
      .filter((q) => q.status === 'GENERADA' && balanceCentsOf(q) > 0)
      .sort((a, b) => balanceCentsOf(b) - balanceCentsOf(a));
    const totalPending = pending.reduce((s, q) => s + balanceCentsOf(q), 0);
    return `
      <header class="top">
        <button class="icon-btn" data-act="home" aria-label="Volver al inicio">${icon.back}</button>
        <div class="title">Cobranza</div>
      </header>
      <section class="summary">
        <div class="muted">Pendiente por cobrar</div>
        <div class="big num">${fmt(totalPending)}</div>
      </section>
      <div class="list">
        ${pending.length ? pending.map((q) => `
          <button class="qrow" data-act="open" data-id="${q.id}">
            <span class="client">${esc(q.client || 'Sin cliente')}</span>
            <span class="total num">${fmt(balanceCentsOf(q))}</span>
            <span class="meta"><span class="mono">${esc(q.folio || '—')}</span> · ${dateStr(q.updatedAt)}</span>
            <span class="pill ${PAYMENT_PILL[paymentStatusOf(q)]}">${PAYMENT_LABEL[paymentStatusOf(q)]}</span>
          </button>`).join('') : '<div class="empty">No hay saldos pendientes. Todo lo cobrado está al día.</div>'}
      </div>`;
  }

  function makePdf(mode) {
    if (!window.jspdf) {
      toast('No se cargó el generador de PDF. Revisa tu conexión y recarga.');
      return null;
    }
    return PDF.blob(S.quote, S.settings, mode);
  }

  /* ---------- configuración ---------- */
  function viewSettings() {
    const s = S.settings;
    return `
      <header class="top">
        <button class="icon-btn" data-act="home" aria-label="Volver al inicio">${icon.back}</button>
        <div class="title">Mi negocio</div>
      </header>
      <form class="stack" id="settings-form">
        <div class="field"><label for="s-name">Nombre comercial</label><input id="s-name" name="businessName" value="${esc(s.businessName)}" placeholder="Ej. Limpieza Express"></div>
        <div class="field">
          <label for="s-logo">Logo</label>
          <div class="row">
            ${s.logo ? `<img class="logo-prev" src="${s.logo}" alt="Logo actual">` : '<span class="hint">Sin logo</span>'}
            <span class="spacer"></span>
            ${s.logo ? '<button type="button" class="btn ghost danger" data-act="logo-remove">Quitar</button>' : ''}
          </div>
          <input id="s-logo" type="file" accept="image/*" style="margin-top:8px">
        </div>
        <div class="field"><label for="s-phone">Teléfono</label><input id="s-phone" name="phone" type="tel" value="${esc(s.phone)}"></div>
        <div class="field"><label for="s-email">Correo</label><input id="s-email" name="email" type="email" value="${esc(s.email)}"></div>
        <div class="field"><label for="s-address">Dirección (opcional)</label><input id="s-address" name="address" value="${esc(s.address)}"></div>
        <div class="field"><label for="s-rfc">RFC (opcional)</label><input id="s-rfc" name="rfc" value="${esc(s.rfc)}" style="text-transform:uppercase"></div>
        <div class="two-col">
          <div class="field"><label for="s-cur">Moneda</label><select id="s-cur" name="currency">${['MXN', 'USD'].map((c) => `<option ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field"><label for="s-iva">IVA predeterminado %</label><input id="s-iva" name="ivaRate" inputmode="decimal" value="${esc(M.centsToStr(s.ivaRateBp).replace(/\.00$/, ''))}"></div>
        </div>
        <div class="two-col">
          <div class="field"><label for="s-ivamode">Si no se menciona IVA</label><select id="s-ivamode" name="ivaMode">${[['mas', 'Más IVA'], ['incluido', 'IVA incluido'], ['sin', 'Sin IVA']].map(([k, l]) => `<option value="${k}" ${s.ivaMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="s-val">Vigencia (días)</label><input id="s-val" name="validityDays" inputmode="numeric" value="${esc(s.validityDays)}"></div>
        </div>
        <div class="field"><label for="s-cond">Condiciones predeterminadas</label><textarea id="s-cond" name="conditions">${esc(s.conditions)}</textarea></div>
        <p class="hint">Productos recordados: ${S.catalog.length}. ${cloudOn && S.cloudSession ? 'Tus datos se guardan en tu cuenta.' : 'Tus cotizaciones y datos se guardan solo en este dispositivo.'}</p>
        <button class="btn primary block" type="submit">Guardar</button>
      </form>
      ${cloudOn && S.cloudSession ? `
        <div class="section-h"><h2>Cuenta</h2></div>
        <div class="stack">
          <p class="hint">Sesión iniciada como ${esc(S.cloudSession.user.email)}</p>
          <button class="btn block" data-act="support-home">Soporte</button>
          <button class="btn block ghost danger" data-act="logout">Cerrar sesión</button>
        </div>` : ''}
      <div class="section-h"><h2>Respaldo</h2></div>
      <div class="stack">
        <p class="hint">Guarda un archivo con tu configuración, catálogo e historial. Sirve para recuperarlos si cambias de teléfono o borras los datos del navegador.</p>
        <button class="btn block" data-act="backup-export">Descargar respaldo</button>
        <label class="btn block ghost" for="backup-file" style="cursor:pointer">Restaurar desde archivo</label>
        <input id="backup-file" type="file" accept="application/json,.json" hidden>
        ${S.pendingBackup ? `
          <div class="confirm-row">Esto reemplaza tu configuración, catálogo e historial actuales por los del archivo (${S.pendingBackup.quotes.length} cotizaciones, ${S.pendingBackup.catalog.length} productos).
            <button class="btn danger" data-act="restore-yes">Restaurar</button>
            <button class="btn" data-act="restore-no">Cancelar</button>
          </div>` : ''}
      </div>
      <div style="height:24px"></div>`;
  }

  function readLogo(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 400 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        S.settings.logo = c.toDataURL('image/png');
        DB.saveSettings(S.settings);
        render();
        toast('Logo guardado');
      };
      img.onerror = () => toast('No se pudo leer la imagen.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function readBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        return toast('Ese archivo no es un respaldo válido de QuoteFlow.');
      }
      const err = DB.validateBackup(data);
      if (err) return toast(err);
      S.pendingBackup = data;
      render();
    };
    reader.onerror = () => toast('No se pudo leer el archivo.');
    reader.readAsText(file);
  }

  /* ---------- eventos ---------- */
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const q = S.quote;
    switch (act) {
      case 'settings': return go('settings');
      case 'home': S.writeOpen = false; return go('home');
      case 'collections': return go('collections');
      case 'toggle-all': S.showAll = !S.showAll; return render();
      case 'speak':
        if (isBusinessBlocked()) return toast('Tu negocio está suspendido; no puedes crear cotizaciones nuevas.');
        return startVoice();
      case 'write':
        if (isBusinessBlocked()) return toast('Tu negocio está suspendido; no puedes crear cotizaciones nuevas.');
        S.writeOpen = true; render(); return document.getElementById('free-text').focus();
      case 'fill-example': document.getElementById('free-text').value = EXAMPLE; return;
      case 'interpret': {
        if (isBusinessBlocked()) return toast('Tu negocio está suspendido; no puedes crear cotizaciones nuevas.');
        const text = document.getElementById('free-text').value.trim();
        if (!text) return toast('Escribe la cotización primero.');
        return interpretText(text);
      }
      case 'reinterpret': {
        const text = document.getElementById('src-text').value.trim();
        if (text) return interpretText(text, q);
        return;
      }
      case 'open': {
        const found = DB.getQuote(b.dataset.id);
        if (!found) return;
        S.quote = found;
        S.interp = null;
        return go(found.status === 'GENERADA' ? 'summary' : 'editor');
      }
      case 'add-item':
        q.items.push({ id: 'i' + Math.random().toString(36).slice(2, 9), desc: '', qtyMilli: 1000, unit: 'pieza', priceCents: null, flags: [], candidates: [] });
        render();
        return document.getElementById('d-' + q.items[q.items.length - 1].id).focus();
      case 'del-item': q.items = q.items.filter((i) => i.id !== b.dataset.id); return render();
      case 'pick': {
        const it = findItem(b.dataset.id);
        const c = it.candidates[+b.dataset.i];
        Object.assign(it, { desc: c.name, priceCents: c.priceCents, unit: c.unit || it.unit, priceSource: 'catalogo', catalogName: c.name, candidates: [], flags: ['precio_catalogo'] });
        return render();
      }
      case 'iva': q.ivaMode = b.dataset.v; return render();
      case 'disc-type': q.discount = { type: b.dataset.v, value: (q.discount && q.discount.value) || 0 }; return render();
      case 'save': persist('BORRADOR'); toast('Borrador guardado · ' + q.folio); return go('home');
      case 'generate': {
        const err = validate(q);
        if (err) { render(); return toast(err); }
        persist('GENERADA');
        return go('summary');
      }
      case 'edit': S.interp = null; return go('editor');
      case 'new': S.writeOpen = false; return go('home');
      case 'pay-voice': return startPaymentVoice();
      case 'del-payment': {
        q.payments = (q.payments || []).filter((p) => p.id !== b.dataset.id);
        savePaymentsChange(q);
        toast('Pago eliminado');
        return render();
      }
      case 'delete': S.confirmDelete = true; return render();
      case 'delete-no': S.confirmDelete = false; return render();
      case 'delete-yes': {
        const idToDelete = q.id;
        DB.deleteQuote(idToDelete);
        toast('Cotización eliminada');
        if (cloudOn && S.cloudBusiness) CLOUD.data.deleteQuote(idToDelete).catch(() => {});
        return go('home');
      }
      case 'share': {
        const blob = makePdf();
        if (!blob) return;
        const r = await SHARE.sharePdf(blob, PDF.filename(q), 'Cotización ' + q.folio, `Cotización ${q.folio} para ${q.client}: total ${fmt(totalsOf(q).total)}`);
        if (r === 'downloaded') toast('Tu navegador no permite compartir archivos; se descargó el PDF.');
        return;
      }
      case 'download': {
        const blob = makePdf();
        if (blob) SHARE.download(blob, PDF.filename(q));
        return;
      }
      case 'view-pdf': {
        const blob = makePdf();
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        if (!window.open(url, '_blank')) location.href = url;
        return;
      }
      case 'share-receipt': {
        const blob = makePdf('estado');
        if (!blob) return;
        const r = await SHARE.sharePdf(blob, PDF.filename(q, 'estado'), 'Estado de cuenta ' + q.folio, `Estado de cuenta ${q.folio} para ${q.client}: saldo pendiente ${fmt(balanceCentsOf(q))}`);
        if (r === 'downloaded') toast('Tu navegador no permite compartir archivos; se descargó el PDF.');
        return;
      }
      case 'download-receipt': {
        const blob = makePdf('estado');
        if (blob) SHARE.download(blob, PDF.filename(q, 'estado'));
        return;
      }
      case 'logo-remove': S.settings.logo = ''; DB.saveSettings(S.settings); return render();
      case 'backup-export': {
        const data = DB.exportBackup();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const stamp = new Date().toISOString().slice(0, 10);
        SHARE.download(blob, `QuoteFlow_respaldo_${stamp}.json`);
        toast('Respaldo descargado');
        return;
      }
      case 'restore-yes': {
        DB.restoreBackup(S.pendingBackup);
        S.settings = DB.getSettings();
        S.catalog = DB.getCatalog();
        S.pendingBackup = null;
        toast('Datos restaurados');
        return go('home');
      }
      case 'restore-no': S.pendingBackup = null; return render();
      case 'auth-toggle': S.authMode = S.authMode === 'login' ? 'register' : 'login'; return render();
      case 'logout': {
        await CLOUD.auth.signOut();
        S.cloudSession = null;
        S.cloudBusiness = null;
        toast('Sesión cerrada');
        return go('auth');
      }
      case 'import-yes': {
        S.authBusy = true;
        render();
        const bizId = S.cloudBusiness.id;
        let failed = 0;
        for (const entry of DB.getCatalog()) {
          try { await CLOUD.data.pushProduct(bizId, entry); } catch (e) { failed++; }
        }
        for (const iq of DB.getQuotes()) {
          try {
            const cloudId = await CLOUD.data.pushQuote(bizId, iq);
            if (cloudId !== iq.id) { DB.deleteQuote(iq.id); iq.id = cloudId; DB.saveQuote(iq); }
          } catch (e) { failed++; }
        }
        DB.setImportDecided();
        S.authBusy = false;
        if (failed) toast(`Se importó lo posible; ${failed} elemento(s) no se pudieron subir. Vuelve a intentar más tarde desde Configuración.`);
        else toast('Datos importados a tu cuenta');
        await pullAndMerge();
        return go('home');
      }
      case 'import-no': {
        DB.setImportDecided();
        await pullAndMerge();
        return go('home');
      }
      case 'support-home': return openSupportHome();
      case 'support-new': return go('support-new');
      case 'support-open': return openSupportTicket(b.dataset.id);
    }
  });

  app.addEventListener('input', (e) => { if (S.view === 'editor') onEditorInput(e); });
  app.addEventListener('change', (e) => {
    if (S.view === 'editor') onEditorChange(e);
    if (e.target.id === 's-logo' && e.target.files[0]) readLogo(e.target.files[0]);
    if (e.target.id === 'backup-file' && e.target.files[0]) readBackupFile(e.target.files[0]);
  });
  app.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);

    if (e.target.id === 'settings-form') {
      const s = S.settings;
      ['businessName', 'phone', 'email', 'address', 'currency', 'ivaMode', 'conditions'].forEach((k) => (s[k] = String(f.get(k) || '').trim()));
      s.rfc = String(f.get('rfc') || '').trim().toUpperCase();
      s.ivaRateBp = M.toBp(f.get('ivaRate')) ?? 1600;
      s.validityDays = parseInt(f.get('validityDays'), 10) || 15;
      DB.saveSettings(s);
      toast('Configuración guardada');
      go('home');
      if (cloudOn && S.cloudBusiness) CLOUD.business.saveSettings(S.cloudBusiness.id, s).catch((err) => toast('No se sincronizó con la nube: ' + err.message));
      return;
    }

    if (e.target.id === 'auth-form') {
      const email = String(f.get('email') || '').trim();
      const password = String(f.get('password') || '');
      S.authBusy = true;
      render();
      try {
        if (S.authMode === 'register') {
          const res = await CLOUD.auth.signUp(email, password);
          if (res.session) {
            S.cloudSession = res.session;
            await afterLogin();
          } else {
            toast('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.');
            S.authMode = 'login';
          }
        } else {
          const res = await CLOUD.auth.signIn(email, password);
          S.cloudSession = res.session;
          await afterLogin();
        }
      } catch (err) {
        toast(err.message);
      } finally {
        S.authBusy = false;
        render();
      }
      return;
    }

    if (e.target.id === 'business-form') {
      const fields = {
        name: String(f.get('name') || '').trim(),
        phone: String(f.get('phone') || '').trim(),
        email: String(f.get('email') || '').trim(),
        rfc: String(f.get('rfc') || '').trim().toUpperCase(),
        currency: String(f.get('currency') || 'MXN'),
        ivaRateBp: M.toBp(f.get('ivaRate')) ?? 1600,
      };
      S.authBusy = true;
      render();
      try {
        S.cloudBusiness = await CLOUD.business.create(fields);
        toast('Negocio creado');
        await afterLogin();
      } catch (err) {
        toast(err.message);
      } finally {
        S.authBusy = false;
        render();
      }
      return;
    }

    if (e.target.id === 'support-new-form') {
      const subject = String(f.get('subject') || '').trim();
      const description = String(f.get('description') || '').trim();
      if (!subject) return toast('Escribe un asunto.');
      try {
        const t = await CLOUD.support.create(S.cloudBusiness.id, S.cloudSession.user.id, subject, description);
        toast('Solicitud enviada');
        S.tickets = [t, ...S.tickets];
        return openSupportTicket(t.id);
      } catch (err) {
        return toast(err.message);
      }
    }

    if (e.target.id === 'payment-form') {
      const amountCents = M.toCents(f.get('amount'));
      if (!amountCents || amountCents <= 0) return toast('Escribe un monto válido.');
      const method = String(f.get('method') || 'efectivo');
      const note = String(f.get('note') || '').trim();
      const q = S.quote;
      q.payments = q.payments || [];
      q.payments.unshift({ id: pid(), amountCents, method, note, paidAt: Date.now() });
      savePaymentsChange(q);
      toast('Pago registrado');
      return render();
    }

    if (e.target.id === 'support-reply-form') {
      const body = String(f.get('body') || '').trim();
      if (!body) return;
      try {
        await CLOUD.support.reply(S.activeTicket.id, S.cloudSession.user.id, body);
        return openSupportTicket(S.activeTicket.id);
      } catch (err) {
        return toast(err.message);
      }
    }
  });

  function render() {
    const views = {
      home: viewHome, editor: viewEditor, summary: viewSummary, settings: viewSettings,
      loading: viewLoading, auth: viewAuth, 'business-new': viewBusinessNew, 'import-prompt': viewImportPrompt,
      'support-list': viewSupportList, 'support-new': viewSupportNew, 'support-ticket': viewSupportTicket,
      collections: viewCollections,
    };
    app.innerHTML = views[S.view]();
  }

  async function boot() {
    if (!cloudOn) return render(); // sin Supabase configurado: exactamente el comportamiento de V0.2
    S.view = 'loading';
    render();
    try {
      CLOUD.auth.onChange((session) => {
        if (!session && S.cloudSession) { // se cerró la sesión en otra pestaña, o expiró
          S.cloudSession = null;
          S.cloudBusiness = null;
          go('auth');
        }
      });
      const session = await CLOUD.auth.getSession();
      S.cloudSession = session;
      if (!session) return go('auth');
      await afterLogin();
    } catch (e) {
      toast('No se pudo conectar con la nube: ' + e.message);
      go('auth');
    }
  }

  boot();
})();
