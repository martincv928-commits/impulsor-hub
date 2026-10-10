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
    customers: DB.getCustomers(),
    activeCustomer: null,
    writeOpen: false,
    homeSearch: '',
    addProductOpen: false,
    restructureOpen: false,
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
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-6 4 3 5-8"/></svg>',
    brand: '<svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="bmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2f3f9e"/><stop offset="100%" stop-color="#5a3fc0"/></linearGradient></defs><rect width="100" height="100" rx="24" fill="url(#bmg)"/><path d="M28 34 Q28 26 36 26 L64 26 Q72 26 72 34 L72 56 Q72 64 64 64 L46 64 L34 74 Q31 76 31 72 L31 64 L36 64 Q28 64 28 56 Z" fill="#fff"/><rect x="40" y="50" width="7" height="9" rx="2" fill="#ffb648"/><rect x="50" y="43" width="7" height="16" rx="2" fill="#ffb648"/><rect x="60" y="35" width="7" height="24" rx="2" fill="#3a2fae"/></svg>',
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
    // Atrapa el botón/gesto de "atrás" del celular: cada pantalla que no sea
    // el inicio deja una marca en el historial del navegador, así que al
    // tocar atrás el sistema la navega igual que tocar la flecha de la app
    // (ver popstate más abajo), en vez de salir de la app de un jalón.
    if (view !== 'home') {
      try { history.pushState({ qfTrap: true }, '', location.href); } catch (e) { /* navegador sin historial: sin problema */ }
    }
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

  // El botón/gesto de "atrás" del celular simplemente toca la misma flecha
  // de "volver" que ya está en la pantalla actual, para que haga exactamente
  // lo mismo (ir un nivel hacia atrás) sin tener que llegar hasta la flecha
  // con el dedo. Si no hay flecha visible (p. ej. ya estamos en el inicio),
  // no se hace nada y el siguiente "atrás" sale de la app con normalidad.
  window.addEventListener('popstate', () => {
    const btn = app.querySelector('header.top .icon-btn[aria-label^="Volver"]');
    if (btn) btn.click();
  });

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
  // Separa "cotizar" de "cobrar": una cotización GENERADA puede traer un plan
  // de pagos propuesto, pero el cobro real (registrar pagos) solo se habilita
  // cuando el cliente la confirma. Las cotizaciones de antes de este cambio
  // (sin este campo) que YA tenían pagos o plan registrados se tratan como
  // confirmadas automáticamente, para no esconderles su historial.
  function isConfirmed(q) {
    if (q.confirmation === 'CONFIRMADA') return true;
    if (q.confirmation === 'RECHAZADA') return false;
    if (q.confirmation === null) return false; // cotización nueva, pendiente de confirmar a propósito
    // cotización de antes de este cambio: ni siquiera tiene el campo
    // (sigue siendo "undefined"), así que se trata como confirmada sin
    // condición. Antes esto solo aplicaba si ya tenía pagos o plan
    // registrado, pero eso escondía de Cobranza y de "pendiente por cobrar"
    // cualquier cotización vieja que todavía no había recibido su primer
    // abono, haciendo parecer que esas cotizaciones habían desaparecido.
    return true;
  }
  const isRejected = (q) => q.confirmation === 'RECHAZADA';
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

  /* ---------- vencimiento y plan de parcialidades (V0.4.2) ---------- */
  // Un vencimiento no se considera pasado hasta que termina SU DÍA (no en
  // cuanto pasa la hora exacta): pagar "hoy" nunca debe marcarse vencido.
  function endOfDay(ts) {
    const d = new Date(ts);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }
  function isOverdue(dueAt) {
    return Date.now() > endOfDay(dueAt);
  }

  // Pequeño punto de color + la etiqueta, para identificar el estado de un
  // vistazo (color) y con certeza (texto) — no solo por el color de fondo del pill.
  const DOT_COLOR = { done: 'var(--ok)', danger: 'var(--danger)', info: 'var(--accent)', draft: 'var(--warn)', muted: 'var(--muted)' };
  function statusChip(pillClass, label) {
    const dot = DOT_COLOR[pillClass] || 'var(--muted)';
    return `<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap"><span style="width:9px;height:9px;border-radius:50%;background:${dot};flex:none;display:inline-block"></span><span class="pill ${pillClass}">${esc(label)}</span></span>`;
  }

  const PAYMENT_DUE_LABEL = { vigente: 'Vigente', vencido: 'Vencido', a_tiempo: 'Pagado a tiempo', con_retraso: 'Pagado con retraso' };
  const PAYMENT_DUE_PILL = { vigente: 'info', vencido: 'danger', a_tiempo: 'done', con_retraso: 'draft' };
  function paymentDueAt(q) {
    if (!q.paymentTermDays) return null;
    const base = q.generatedAt || q.updatedAt || Date.now();
    return base + q.paymentTermDays * 86400000;
  }
  function paymentDueStatus(q) {
    const due = paymentDueAt(q);
    if (!due) return null;
    if (paymentStatusOf(q) === 'PAGADO') {
      const lastPaidAt = (q.payments || []).reduce((m, p) => Math.max(m, p.paidAt), 0);
      return lastPaidAt <= endOfDay(due) ? 'a_tiempo' : 'con_retraso';
    }
    return isOverdue(due) ? 'vencido' : 'vigente';
  }
  const sortedInstallments = (q) => (q.installments || []).slice().sort((a, b) => a.dueAt - b.dueAt);
  // Combina "qué tanto se ha abonado" (nada / parcial / completo) con "llegó
  // a tiempo" para dar un solo indicador claro por parcialidad.
  const INSTALLMENT_LABEL = {
    A_TIEMPO: 'Pagada a tiempo', PAGADA_TARDE: 'Pagada a destiempo',
    PARCIAL_PENDIENTE: 'Pago parcial', PARCIAL_VENCIDA: 'Pago parcial (vencida)',
    PENDIENTE: 'Pendiente', VENCIDA: 'Vencida',
  };
  const INSTALLMENT_PILL = {
    A_TIEMPO: 'done', PAGADA_TARDE: 'draft',
    PARCIAL_PENDIENTE: 'info', PARCIAL_VENCIDA: 'danger',
    PENDIENTE: 'muted', VENCIDA: 'danger',
  };

  // Estado de un pago individual: si al momento en que se recibió ya había
  // algo vencido sin cubrir (según el plan de parcialidades, o si no hay
  // plan, según el vencimiento general), llegó tarde; si no, a tiempo.
  const PAYMENT_TIMELINESS_LABEL = { a_tiempo: 'A tiempo', atrasado: 'Atrasado' };
  const PAYMENT_TIMELINESS_PILL = { a_tiempo: 'done', atrasado: 'danger' };
  function paymentTimeliness(q, payment) {
    const list = sortedInstallments(q);
    if (list.length) {
      const before = (q.payments || [])
        .filter((p) => p.paidAt < payment.paidAt || (p.paidAt === payment.paidAt && p.id < payment.id))
        .reduce((s, p) => s + p.amountCents, 0);
      const requiredAsOf = list.filter((inst) => inst.dueAt <= payment.paidAt).reduce((s, inst) => s + inst.amountCents, 0);
      return before < requiredAsOf ? 'atrasado' : 'a_tiempo';
    }
    const due = paymentDueAt(q);
    if (!due) return null;
    return payment.paidAt <= endOfDay(due) ? 'a_tiempo' : 'atrasado';
  }

  // Reparte el total abonado (en cualquier fecha) entre las parcialidades en
  // orden ("cascada"): lo que sobra de llenar la 1 pasa a la 2, etc. Esto es
  // lo que dice si cada parcialidad quedó liquidada, parcial o sin pago.
  // El "a tiempo / a destiempo / vencida" se calcula aparte, comparando qué
  // tanto ya estaba cubierto en la fecha de vencimiento de cada una (por día
  // completo, no por la hora exacta: pagar el mismo día nunca es "vencida").
  function installmentProgress(q) {
    const list = sortedInstallments(q);
    const totalPaid = paidCentsOf(q);
    const paidByDate = (dueAt) => {
      const cutoff = endOfDay(dueAt);
      return (q.payments || []).filter((p) => p.paidAt <= cutoff).reduce((s, p) => s + p.amountCents, 0);
    };
    let cumRequired = 0;
    return list.map((inst) => {
      const requiredThroughPrev = cumRequired;
      cumRequired += inst.amountCents;
      const allocated = Math.min(inst.amountCents, Math.max(0, totalPaid - requiredThroughPrev));
      const remaining = inst.amountCents - allocated;
      const liquidadaByDue = paidByDate(inst.dueAt) >= cumRequired;
      const liquidadaNow = totalPaid >= cumRequired;
      const overdue = isOverdue(inst.dueAt);
      let timeliness;
      if (remaining <= 0) timeliness = liquidadaByDue ? 'A_TIEMPO' : 'PAGADA_TARDE';
      else if (allocated > 0) timeliness = overdue ? 'PARCIAL_VENCIDA' : 'PARCIAL_PENDIENTE';
      else timeliness = overdue ? 'VENCIDA' : 'PENDIENTE';
      return Object.assign({}, inst, { allocated, remaining, timeliness });
    });
  }

  // Cuánto de una cotización está vencido AHORA MISMO. Antes "vencido" en
  // Cobranza y en el cliente moroso solo miraba el plazo de pago GENERAL
  // (paymentTermDays), así que un negocio que solo usa plan de
  // parcialidades (sin poner un plazo general) nunca veía nada marcado como
  // vencido ahí, aunque alguna parcialidad sí lo estuviera.
  function quoteOverdueAmount(q) {
    const progress = installmentProgress(q);
    if (progress.length) {
      return progress.filter((p) => p.timeliness === 'VENCIDA' || p.timeliness === 'PARCIAL_VENCIDA').reduce((s, p) => s + p.remaining, 0);
    }
    return paymentDueStatus(q) === 'vencido' ? balanceCentsOf(q) : 0;
  }
  const isQuoteOverdue = (q) => quoteOverdueAmount(q) > 0;
  // Fecha de vencimiento más antigua sin cubrir, para decir desde cuándo.
  function earliestOverdueDate(q) {
    const progress = installmentProgress(q);
    if (progress.length) {
      const overdue = progress.filter((p) => p.timeliness === 'VENCIDA' || p.timeliness === 'PARCIAL_VENCIDA');
      return overdue.length ? overdue[0].dueAt : null;
    }
    return paymentDueStatus(q) === 'vencido' ? paymentDueAt(q) : null;
  }

  /* ---------- base de clientes (V0.4.3, opcional: nada obliga a guardar) ---------- */
  function findCustomer(name) {
    const key = CAT.key(name);
    return key ? S.customers.find((c) => CAT.key(c.name) === key) || null : null;
  }
  // Enlace de WhatsApp con un recordatorio de cobro prellenado — sin backend
  // ni integración, solo abre la conversación con el texto listo para enviar.
  // Si hay algo VENCIDO se dice explícitamente (no solo "saldo pendiente").
  function waReminderLink(c, debtCents, overdueCents) {
    const digits = String(c.phone || '').replace(/\D/g, '');
    const biz = S.settings.businessName || 'nosotros';
    const msg = overdueCents > 0
      ? `Hola ${c.name}, de parte de ${biz}: tienes un pago VENCIDO por ${fmt(overdueCents)} (saldo total pendiente: ${fmt(debtCents)}). ¿Cuándo podrías cubrirlo? Gracias.`
      : `Hola ${c.name}, de parte de ${biz}: tienes un saldo pendiente de ${fmt(debtCents)}. ¿Cuándo podrías cubrirlo? Gracias.`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
  }

  function customerInfo(name) {
    const key = CAT.key(name);
    if (!key) return { debt: 0, moroso: false, quotes: [] };
    const quotes = DB.getQuotes().filter((q) => q.status === 'GENERADA' && CAT.key(q.client) === key);
    const confirmed = quotes.filter((q) => !isRejected(q) && isConfirmed(q));
    const debt = confirmed.reduce((s, q) => s + balanceCentsOf(q), 0);
    const moroso = confirmed.some(isQuoteOverdue);
    return { debt, moroso, quotes };
  }
  function saveCustomer(name, phone, notes) {
    const clean = String(name || '').trim();
    if (!clean || findCustomer(clean)) return false;
    const c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: clean, phone: String(phone || '').trim(), notes: String(notes || '').trim(), createdAt: Date.now(), updatedAt: Date.now() };
    S.customers = S.customers.concat([c]);
    DB.saveCustomers(S.customers);
    syncCustomerToCloud(c);
    return true;
  }

  // Edita teléfono/notas de un cliente ya guardado (antes solo se podía
  // agregar o quitar, nunca cambiar sus datos).
  function updateCustomer(id, fields) {
    const c = S.customers.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, fields, { updatedAt: Date.now() });
    DB.saveCustomers(S.customers);
    syncCustomerToCloud(c);
  }

  function syncCustomerToCloud(c) {
    if (!(cloudOn && S.cloudBusiness)) return;
    CLOUD.data.pushCustomer(S.cloudBusiness.id, CAT.key(c.name), c).catch((e) => toast('No se sincronizó el cliente con la nube: ' + e.message));
  }

  /* ---------- cuenta / negocio (V0.3, solo si hay Supabase configurado) ---------- */

  function viewLoading() {
    return `<div class="hero"><p class="muted">Cargando…</p></div>`;
  }

  function viewAuth() {
    const login = S.authMode === 'login';
    return `
      <div class="hero" style="padding-top:14px">
        <div class="brand">${icon.brand}<span>QuoteFlow</span></div>
      </div>
      <form class="stack" id="auth-form">
        <h2 class="title">${login ? 'Inicia sesión' : 'Crea tu cuenta'}</h2>
        <div class="field"><label for="a-email">Correo</label><input id="a-email" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="a-pass">Contraseña</label><input id="a-pass" name="password" type="password" required minlength="6" autocomplete="${login ? 'current-password' : 'new-password'}"></div>
        <button class="btn primary block" type="submit" ${S.authBusy ? 'disabled' : ''}>${S.authBusy ? 'Un momento…' : login ? 'Entrar' : 'Crear cuenta'}</button>
        <button class="btn ghost block" type="button" data-act="auth-toggle">${login ? '¿No tienes cuenta? Créala' : '¿Ya tienes cuenta? Inicia sesión'}</button>
      </form>
      <button class="btn ghost block" type="button" data-act="feedback-open" style="margin-top:4px">¿Tienes un problema o una duda? Escríbenos</button>`;
  }

  function viewBusinessNew() {
    const s = S.settings; // se usan como sugerencia inicial si ya había datos locales de V0.2
    return `
      <div class="hero" style="padding-top:14px"><div class="brand">${icon.brand}<span>QuoteFlow</span></div></div>
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
      <div class="hero" style="padding-top:14px"><div class="brand">${icon.brand}<span>QuoteFlow</span></div></div>
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
    const { catalog, quotes, customers } = await CLOUD.data.pull(S.cloudBusiness.id);
    DB.saveCatalog(catalog);
    S.catalog = catalog;
    quotes.forEach((q) => DB.saveQuote(q));
    // Clientes: se mezclan por nombre normalizado en vez de reemplazar todo,
    // para no perder uno guardado localmente que aún no se haya subido.
    const localCustomers = DB.getCustomers();
    const byKey = new Map(localCustomers.map((c) => [CAT.key(c.name), c]));
    (customers || []).forEach((c) => byKey.set(CAT.key(c.name), c));
    S.customers = Array.from(byKey.values());
    DB.saveCustomers(S.customers);
  }

  // Cotizaciones que no están al día en la nube: o nunca se importaron (su
  // id sigue siendo el local, no un UUID real), o ya tenían un id de la nube
  // pero una edición posterior falló al sincronizar (_syncFailed).
  const pendingSyncQuotes = () => DB.getQuotes().filter((q) => !CLOUD.looksLikeUuid(q.id) || q._syncFailed);

  // Sube catálogo y cotizaciones locales a la cuenta. Si el negocio ya tenía
  // sus propias cotizaciones (otro dispositivo, u otra persona probando la
  // misma cuenta) y un folio local choca con uno que ya existe en la nube,
  // se le asigna un folio nuevo en vez de dejar que la subida falle en
  // silencio — así ninguna cotización se queda nada más en este dispositivo
  // por una coincidencia de folio. Una cotización que YA tenía id de la nube
  // (solo falló una edición) no se renumera, solo se reintenta tal cual.
  async function importLocalDataToCloud(bizId) {
    let failed = 0;
    for (const entry of DB.getCatalog()) {
      try { await CLOUD.data.pushProduct(bizId, entry); } catch (e) { failed++; }
    }
    const pending = pendingSyncQuotes();
    const taken = new Set(await CLOUD.data.folios(bizId).catch(() => []));
    for (const iq of pending) {
      const isNew = !CLOUD.looksLikeUuid(iq.id);
      if (isNew && (!iq.folio || taken.has(iq.folio))) {
        let folio;
        do { folio = DB.nextFolio(); } while (taken.has(folio));
        iq.folio = folio;
      }
      taken.add(iq.folio);
      try {
        const cloudId = await CLOUD.data.pushQuote(bizId, iq);
        delete iq._syncFailed;
        if (cloudId !== iq.id) { DB.deleteQuote(iq.id); iq.id = cloudId; DB.saveQuote(iq); }
        else DB.saveQuote(iq);
      } catch (e) { failed++; }
    }
    return { failed, total: pending.length };
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
        <div class="field"><label for="t-subject">Asunto</label><input id="t-subject" name="subject" required maxlength="200"></div>
        <div class="field">
          <label for="t-desc">Cuéntanos qué pasa</label>
          <div class="row">
            <textarea id="t-desc" name="description" required maxlength="5000" style="min-height:120px;flex:1"></textarea>
            <button type="button" class="icon-btn" data-act="support-desc-voice" aria-label="Dictar descripción">${icon.mic}</button>
          </div>
        </div>
        <div class="field"><label for="t-image">Foto o captura de pantalla (opcional)</label><input id="t-image" type="file" accept="image/*"></div>
        <button class="btn primary block" type="submit">Enviar</button>
      </form>`;
  }

  // Para quien aún no tiene cuenta/negocio (solo está probando la app, sin
  // haber iniciado sesión): un formulario simple que no depende de un
  // negocio ni de sesión, y que de todos modos le llega al panel de admin.
  function viewFeedback() {
    const backTo = cloudOn && S.cloudSession ? 'settings' : 'auth';
    return `
      <header class="top">
        <button class="icon-btn" data-act="${backTo}" aria-label="Volver">${icon.back}</button>
        <div class="title">Soporte</div>
      </header>
      <form class="stack" id="feedback-form">
        <p class="hint">¿Tienes un problema o una sugerencia? Mándanosla; no necesitas haber iniciado sesión.</p>
        <div class="field"><label for="fb-subject">Asunto</label><input id="fb-subject" name="subject" required maxlength="200"></div>
        <div class="field">
          <label for="fb-desc">Cuéntanos qué pasa</label>
          <div class="row">
            <textarea id="fb-desc" name="description" required maxlength="5000" style="min-height:120px;flex:1"></textarea>
            <button type="button" class="icon-btn" data-act="feedback-desc-voice" aria-label="Dictar descripción">${icon.mic}</button>
          </div>
        </div>
        <div class="field"><label for="fb-image">Foto o captura de pantalla (opcional)</label><input id="fb-image" type="file" accept="image/*"></div>
        <div class="field"><label for="fb-contact">Tu correo o teléfono (opcional, para responderte)</label><input id="fb-contact" name="contact" maxlength="200"></div>
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
    const generated = quotes.filter((q) => q.status === 'GENERADA' && !isRejected(q));
    const totalCotizado = generated.reduce((s, q) => s + totalsOf(q).total, 0);
    const totalPendiente = generated.filter(isConfirmed).reduce((s, q) => s + balanceCentsOf(q), 0);
    return `
      <header class="top">
        <div class="brand">${icon.brand}<span>QuoteFlow${name ? `<small>${esc(name)}</small>` : ''}</span></div>
        <span class="spacer"></span>
        <button class="icon-btn" data-act="reports" aria-label="Reportes">${icon.chart}</button>
        <button class="icon-btn" data-act="collections" aria-label="Cobranza">${icon.cash}</button>
        <button class="icon-btn" data-act="clients" aria-label="Clientes">${icon.people}</button>
        <button class="icon-btn" data-act="settings" aria-label="Configuración del negocio">${icon.gear}</button>
      </header>
      ${!name ? `<button class="example" data-act="settings">Configura el nombre y datos de tu negocio para que aparezcan en el PDF. <b>Configurar</b></button>` : ''}
      ${generated.length ? `
      <div class="stat-pair">
        <div class="stat"><div class="lbl">Total cotizado</div><div class="val">${fmt(totalCotizado)}</div></div>
        <button class="stat" data-act="collections" style="text-align:left;cursor:pointer">
          <div class="lbl">Pendiente por cobrar</div>
          <div class="val" style="${totalPendiente > 0 ? 'color:var(--danger)' : ''}">${fmt(totalPendiente)}</div>
        </button>
      </div>` : ''}
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
      ${S.settings.homeList === 'collections' ? collectionsListSection() : quotesListSection(quotes, shown)}`;
  }

  function quoteRowHtml(q) {
    return `
      <button class="qrow" data-act="open" data-id="${q.id}">
        <span class="client">${esc(q.client || 'Sin cliente')}</span>
        <span class="total num">${fmt(totalsOf(q).total)}</span>
        <span class="meta"><span class="mono">${esc(q.folio || '—')}</span> · ${dateStr(q.updatedAt)}</span>
        <span style="display:flex;gap:6px;justify-self:end">
          ${q.status === 'GENERADA' && q.confirmation ? statusChip(CONFIRMATION_PILL[q.confirmation], CONFIRMATION_LABEL[q.confirmation]) : `<span class="pill ${q.status === 'GENERADA' ? 'done' : 'draft'}">${q.status === 'GENERADA' && q.confirmation === null ? 'Por confirmar' : q.status}</span>`}
          ${q.status === 'GENERADA' && isConfirmed(q) ? statusChip(PAYMENT_PILL[paymentStatusOf(q)], PAYMENT_LABEL[paymentStatusOf(q)]) : ''}
        </span>
      </button>`;
  }

  function filterQuotesBySearch(quotes, search) {
    const s = search.trim().toLowerCase();
    if (!s) return null; // null = sin búsqueda activa
    return quotes.filter((x) => (x.client || '').toLowerCase().includes(s) || (x.folio || '').toLowerCase().includes(s));
  }

  // La lista de resultados se actualiza tecla por tecla sin volver a dibujar
  // toda la pantalla (eso le quitaría el foco al campo de búsqueda a media
  // palabra); solo se reescribe el contenido de la lista.
  function refreshHomeSearch() {
    const listEl = document.getElementById('home-quotes-list');
    const headEl = document.getElementById('home-quotes-head');
    if (!listEl) return;
    const quotes = DB.getQuotes();
    const filtered = filterQuotesBySearch(quotes, S.homeSearch);
    const shown = filtered || (S.showAll ? quotes : quotes.slice(0, 12));
    listEl.innerHTML = shown.length ? shown.map(quoteRowHtml).join('') : `<div class="empty">${filtered ? 'Sin resultados.' : 'Aún no hay cotizaciones. Toca <b>Hablar</b> o <b>Escribir</b> para crear la primera.'}</div>`;
    if (headEl) headEl.textContent = filtered ? 'Resultados' : 'Cotizaciones recientes';
  }

  function quotesListSection(quotes, shown) {
    const filtered = filterQuotesBySearch(quotes, S.homeSearch);
    const rows = filtered || shown;
    return `
      <div class="field" style="margin-top:10px"><input id="home-search" placeholder="Buscar por cliente o folio…" value="${esc(S.homeSearch)}"></div>
      <div class="section-h"><h2 id="home-quotes-head">${filtered ? 'Resultados' : 'Cotizaciones recientes'}</h2>${!filtered && quotes.length > 12 ? `<button class="btn ghost" data-act="toggle-all">${S.showAll ? 'Ver menos' : 'Ver todas'}</button>` : ''}</div>
      <div class="list" id="home-quotes-list">
        ${rows.length ? rows.map(quoteRowHtml).join('') : `<div class="empty">Aún no hay cotizaciones. Toca <b>Hablar</b> o <b>Escribir</b> para crear la primera.</div>`}
      </div>`;
  }

  function collectionsListSection() {
    const pending = pendingCollectionsQuotes();
    return `
      <div class="section-h"><h2>Pendientes por cobrar</h2><button class="btn ghost" data-act="collections">Ver cobranza</button></div>
      <div class="list">${collectionsRows(pending)}</div>`;
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
    const customerEntries = S.customers.map((c) => ({ key: CAT.key(c.name), name: c.name }));
    const res = await interpreter.interpret(text, { catalog: S.catalog, customers: customerEntries, settings: S.settings });
    const now = Date.now();
    const base = keep || { id: uid(), folio: null, status: 'BORRADOR', createdAt: now, conditions: S.settings.conditions, paymentTermDays: S.settings.paymentTermDays || 0 };
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
        <div class="field">
          <label for="client">Cliente</label>
          <div class="row">
            <input id="client" data-q="client" value="${esc(q.client)}" placeholder="Nombre del cliente" list="client-list" class="${q.client ? '' : 'missing'}" style="flex:1">
            <button type="button" class="icon-btn" data-act="save-client" aria-label="Guardar cliente" title="Guardar como cliente recurrente" style="font-size:20px">☆</button>
          </div>
          ${q.client && customerInfo(q.client).moroso ? '<p class="hint" style="color:var(--danger)">⚠ Este cliente tiene pagos vencidos en otra cotización.</p>' : ''}
        </div>
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
        <div class="field"><label for="payterm">Plazo de pago (días, 0 = de contado)</label><input id="payterm" data-q="paymentTerm" inputmode="numeric" class="num" value="${esc(q.paymentTermDays || 0)}"></div>
        <div class="field"><label for="saledate">Fecha de la venta</label><input id="saledate" data-q="saleDate" type="date" value="${todayInputStr(q.generatedAt)}" max="${todayInputStr()}"></div>
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
      <datalist id="client-list">${S.customers.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
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
    if (f === 'paymentTerm') q.paymentTermDays = parseInt(t.value, 10) || 0;
    if (f === 'saleDate' && t.value) q.generatedAt = new Date(t.value + 'T12:00:00').getTime();
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
      return;
    }
    if (t.id === 'client' && t.value.trim()) {
      render();
      if (customerInfo(t.value.trim()).moroso) toast('⚠ Este cliente tiene pagos vencidos en otra cotización.');
    }
  }

  function validate(q) {
    if (!q.items.length) return 'Agrega al menos un concepto.';
    const bad = q.items.filter((it) => { const m = itemMissing(it); return m.qty || m.price || m.desc; });
    if (bad.length) return 'Completa cantidad y precio de: ' + bad.map((b) => b.desc || 'concepto sin nombre').join(', ');
    if (!String(q.client || '').trim()) return 'Escribe el nombre del cliente.';
    return null;
  }

  // Si dos conceptos terminan siendo el mismo producto (misma clave de
  // catálogo), mismo precio y misma unidad, se juntan en una sola línea
  // sumando las cantidades, en vez de dejarlos duplicados. Esto cubre tanto
  // un doble toque accidental (p. ej. en "agregar producto") como una
  // autocorrección al dictar ("dos playeras... digo, tres playeras a 100
  // cada una", que el reconocimiento de voz a veces repite completo). Nunca
  // se juntan conceptos que aún necesitan revisión (sin cantidad/precio, o
  // ambiguos con varios candidatos), ni uno agregado después con uno de la
  // venta original, para no perder esa distinción.
  function mergeDuplicateItems(items) {
    const merged = [];
    const index = new Map();
    items.forEach((it) => {
      const key = CAT.key(it.desc);
      const canMerge = key && it.qtyMilli !== null && it.priceCents !== null && !(it.candidates && it.candidates.length);
      if (canMerge) {
        const dupKey = [key, it.priceCents, it.unit || '', it.addedAt || ''].join('|');
        const idx = index.get(dupKey);
        if (idx !== undefined) {
          merged[idx].qtyMilli += it.qtyMilli;
          return;
        }
        index.set(dupKey, merged.length);
      }
      merged.push(it);
    });
    return merged;
  }

  function persist(status) {
    const q = S.quote;
    const now = Date.now();
    if (!q.folio) q.folio = DB.nextFolio();
    q.status = status;
    q.updatedAt = now;
    // Solo se pone la fecha de venta la primera vez que se genera: si ya
    // tenía una (la de hoy, o una que el usuario haya puesto a mano para una
    // venta pasada), no se pisa al volver a generar (p. ej. tras agregar un
    // producto).
    if (status === 'GENERADA' && !q.generatedAt) {
      q.generatedAt = now;
      // Marca explícitamente que esta cotización (nueva, de aquí en
      // adelante) todavía espera que el cliente la confirme o la rechace;
      // las de antes de este cambio ni siquiera tienen este campo.
      if (q.confirmation === undefined) q.confirmation = null;
    }
    q.items = mergeDuplicateItems(q.items);
    q.items.forEach((it) => { it.candidates = []; });
    reconcileInstallments(q);
    q.totals = totalsOf(q);
    DB.saveQuote(q);
    let cat = S.catalog;
    q.items.forEach((it) => { cat = CAT.upsert(cat, it, now); });
    S.catalog = cat;
    DB.saveCatalog(cat);
    syncQuoteToCloud(q, cat);
  }

  // Si el total cambia (se agrega/edita un producto) y ya había un plan de
  // parcialidades SIN ningún abono todavía, es seguro repartir el nuevo total
  // entre las mismas parcialidades (mismas fechas), tal cual al generar el
  // plan. En cuanto ya hay pagos registrados, esto ya NO se toca solo: hay
  // historial que respetar (qué se pagó a tiempo, etc.), así que se deja que
  // el usuario decida y reestructure con restructurePlan().
  function reconcileInstallments(q) {
    if (!q.installments || !q.installments.length) return;
    if (q.payments && q.payments.length) return;
    const total = totalsOf(q).total;
    const sorted = sortedInstallments(q);
    const count = sorted.length;
    const per = Math.floor(total / count);
    let assigned = 0;
    q.installments = sorted.map((inst, i) => {
      const amt = i === count - 1 ? total - assigned : per;
      assigned += amt;
      return Object.assign({}, inst, { amountCents: amt });
    });
  }

  // Reestructura el plan con el SALDO PENDIENTE (no el total de la
  // cotización): las parcialidades ya liquidadas se quedan como historial
  // (con su fecha original, para no perder si se pagaron a tiempo o no). Una
  // parcialidad con abono PARCIAL también se conserva por lo ya cubierto (con
  // su fecha original), y solo lo que falta de ella entra al plan nuevo junto
  // con el resto del saldo — así la suma del plan sigue cuadrando siempre con
  // el total y no se pierde el abono ya hecho.
  // Las fechas del plan nuevo se cuentan a partir de la fecha de la
  // cotización (no de "hoy", el día en que se reestructura): si se contaran
  // desde hoy, cada reestructuración correría los vencimientos hacia
  // adelante y todo parecería "a tiempo" aunque en realidad ya iba atrasado.
  function restructurePlan(q, count, interval) {
    const balance = balanceCentsOf(q);
    if (balance <= 0) return false;
    const progress = installmentProgress(q);
    const kept = [];
    progress.forEach((p) => {
      if (p.remaining <= 0) kept.push({ id: p.id, dueAt: p.dueAt, amountCents: p.amountCents });
      else if (p.allocated > 0) kept.push({ id: p.id, dueAt: p.dueAt, amountCents: p.allocated });
    });
    q.installmentHistory = (q.installmentHistory || []).concat([{ installments: q.installments, replacedAt: Date.now() }]);
    const base = q.generatedAt || q.updatedAt || Date.now();
    const per = Math.floor(balance / count);
    let assigned = 0;
    const fresh = [];
    for (let i = 0; i < count; i++) {
      const amt = i === count - 1 ? balance - assigned : per;
      assigned += amt;
      fresh.push({ id: pid(), dueAt: base + interval * (kept.length + i + 1) * 86400000, amountCents: amt });
    }
    q.installments = kept.concat(fresh);
    return true;
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
        delete q._syncFailed;
        if (cloudId !== q.id) {
          DB.deleteQuote(q.id);
          q.id = cloudId;
        }
        DB.saveQuote(q);
      })
      .catch((e) => {
        // Se marca para que "Sincronización pendiente" en Configuración lo
        // detecte y se pueda reintentar, aunque esta cotización YA tuviera
        // un id real de la nube (de lo contrario un fallo en una edición
        // posterior a la primera subida pasaba totalmente desapercibido).
        q._syncFailed = true;
        DB.saveQuote(q);
        toast('Se guardó en este dispositivo, pero no se sincronizó con la nube: ' + e.message);
      });
    q.items.forEach((it) => {
      const entry = cat.find((c) => c.key === CAT.key(it.desc));
      if (entry) CLOUD.data.pushProduct(bizId, entry).catch(() => {});
    });
  }

  /* ---------- resumen / compartir ---------- */
  const CONFIRMATION_LABEL = { CONFIRMADA: 'Confirmada', RECHAZADA: 'Rechazada' };
  const CONFIRMATION_PILL = { CONFIRMADA: 'done', RECHAZADA: 'danger' };

  function viewSummary() {
    const q = S.quote;
    const t = totalsOf(q);
    const confirmed = isConfirmed(q);
    const rejected = isRejected(q);
    const explicit = q.confirmation === 'CONFIRMADA' || q.confirmation === 'RECHAZADA';
    return `
      <header class="top">
        <button class="icon-btn" data-act="home" aria-label="Volver al inicio">${icon.back}</button>
        <div class="title mono">${esc(q.folio)}</div>
        <span class="spacer"></span>
        <span class="pill ${explicit ? CONFIRMATION_PILL[q.confirmation] : q.status === 'GENERADA' ? 'done' : 'draft'}">${explicit ? CONFIRMATION_LABEL[q.confirmation] : q.status}</span>
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
        ${q.status === 'GENERADA' && !confirmed && !rejected ? `
          <div class="banner media">
            <div class="head">¿El cliente ya confirmó esta cotización?</div>
            <p style="margin:0">Mientras no la confirmes, puedes proponer un plan de pagos, pero no se registran cobros todavía.</p>
          </div>
          <div class="two-col">
            <button class="btn primary block" data-act="confirm-quote">Confirmar</button>
            <button class="btn ghost danger block" data-act="reject-quote">Rechazar</button>
          </div>
        ` : ''}
        ${rejected ? `
          <div class="banner baja">
            <div class="head">Cotización rechazada</div>
            <p style="margin:0">El cliente no aceptó esta cotización. No cuenta en tu pendiente por cobrar.</p>
          </div>
          <button class="btn ghost block" data-act="confirm-quote">Marcarla como confirmada en su lugar</button>
        ` : ''}
        <div class="sheet"><table class="num">
          ${q.items.map((it) => `<tr><td>${esc(M.milliToStr(it.qtyMilli))} ${esc(it.unit)} · ${esc(it.desc)}<div class="muted">${fmt(it.priceCents)} c/u</div>${it.addedAt ? `<div class="muted" style="font-size:11px;font-style:italic">Agregado el ${dateStr(it.addedAt)}</div>` : ''}</td><td class="r">${fmt(M.lineAmount(it))}</td></tr>`).join('')}
          <tr><td class="muted">Subtotal</td><td class="r">${fmt(t.subtotal)}</td></tr>
          ${t.discount ? `<tr><td class="muted">Descuento</td><td class="r">-${fmt(t.discount)}</td></tr>` : ''}
          ${q.ivaMode !== 'sin' ? `<tr><td class="muted">IVA${q.ivaMode === 'incluido' ? ' incluido' : ''}</td><td class="r">${fmt(t.iva)}</td></tr>` : ''}
          <tr><td><b>Total</b></td><td class="r"><b>${fmt(t.total)}</b></td></tr>
        </table></div>
        ${addProductSection()}
        ${!rejected ? paymentsSection(q) : ''}
        <div class="two-col">
          <button class="btn" data-act="edit">Editar</button>
          <button class="btn" data-act="new">Nueva cotización</button>
        </div>
      </div>`;
  }

  // Agregar un producto a una cotización ya generada, directo o por voz, sin
  // perder el estado GENERADA ni la fecha de venta ya registrada. Si hay un
  // plan de parcialidades, se reajusta solo al nuevo total (mismas fechas).
  function addProductSection() {
    return `
      <div class="section-h"><h2>Agregar producto</h2></div>
      ${S.addProductOpen ? `
        <div class="stack">
          <div class="row">
            <textarea id="add-product-text" placeholder="Ej. 2 piezas de foco a 45 pesos" style="flex:1;min-height:60px"></textarea>
            <button type="button" class="icon-btn" data-act="add-product-voice" aria-label="Dictar producto">${icon.mic}</button>
          </div>
          <div class="field"><label for="add-product-date">Fecha en que se agregó</label><input id="add-product-date" type="date" value="${todayInputStr()}" max="${todayInputStr()}"></div>
          <button class="btn primary block" data-act="add-product-submit">Agregar a la cotización</button>
        </div>
      ` : `<button class="btn block ghost" data-act="add-product-open">+ Agregar producto</button>`}`;
  }

  function addProductsToQuote(text) {
    const q = S.quote;
    const items = P.parseItems(text, { catalog: S.catalog });
    if (!items.length) return toast('No se entendió ningún producto. Intenta de nuevo.');
    const dateInput = document.getElementById('add-product-date');
    const addedAt = dateInput && dateInput.value ? new Date(dateInput.value + 'T12:00:00').getTime() : Date.now();
    items.forEach((it) => { it.addedAt = addedAt; q.items.push(it); });
    persist(q.status);
    const incomplete = items.some((it) => it.qtyMilli === null || it.priceCents === null || (it.candidates && it.candidates.length));
    toast(incomplete ? 'Producto agregado; revisa cantidad/precio en Editar.' : 'Producto agregado: ' + items.map((i) => i.desc).join(', '));
    S.addProductOpen = false;
    render();
  }

  function todayInputStr(ts) {
    const d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Antes de que el cliente confirme, solo se puede PROPONER un plan de
  // pagos (parte de la cotización); una vez confirmada se habilita el cobro
  // real (registrar abonos, ver estado de cuenta). Separar esto evita
  // "cobrar" sobre algo que el cliente todavía ni acepta.
  function proposedPlanSection(q) {
    const total = totalsOf(q).total;
    const progress = installmentProgress(q);
    return `
      <div class="section-h"><h2>Plan de pagos propuesto</h2></div>
      <p class="hint">Puedes proponer cómo se pagaría esta cotización. El cobro real se habilita hasta que la confirmes.</p>
      ${progress.length ? `
        <div class="list">
          ${progress.map((inst, i) => `
            <div class="qrow" style="grid-template-columns:1fr auto">
              <span class="client">Parcialidad ${i + 1} · ${fmt(inst.amountCents)}</span>
              <span class="meta">Vence ${dateStr(inst.dueAt)}</span>
            </div>`).join('')}
        </div>
        <button class="btn ghost danger block" data-act="clear-installments">Quitar plan propuesto</button>
      ` : `
        <form class="stack" id="installments-form">
          <div class="two-col">
            <div class="field"><label for="inst-count">Número de parcialidades</label><input id="inst-count" name="count" inputmode="numeric" class="num" value="3"></div>
            <div class="field"><label for="inst-interval">Días entre cada una</label><input id="inst-interval" name="interval" inputmode="numeric" class="num" value="30"></div>
          </div>
          <button class="btn block" type="submit">Proponer plan</button>
        </form>
      `}`;
  }

  function paymentsSection(q) {
    if (!isConfirmed(q)) return proposedPlanSection(q);
    const total = totalsOf(q).total;
    const paid = paidCentsOf(q);
    const balance = balanceCentsOf(q);
    const status = paymentStatusOf(q);
    const payments = q.payments || [];
    const due = paymentDueAt(q);
    const dueStatus = paymentDueStatus(q);
    const progress = installmentProgress(q);
    return `
      <div class="section-h"><h2>Cobro</h2>${statusChip(PAYMENT_PILL[status], PAYMENT_LABEL[status])}</div>
      ${due ? `<p class="hint">Vence el ${dateStr(due)} <span style="margin-left:6px">${statusChip(PAYMENT_DUE_PILL[dueStatus], PAYMENT_DUE_LABEL[dueStatus])}</span></p>` : ''}
      <div class="sheet"><table class="num">
        <tr><td class="muted">Pagado</td><td class="r">${fmt(paid)}</td></tr>
        <tr><td><b>Saldo</b></td><td class="r"><b>${fmt(balance)}</b></td></tr>
      </table></div>
      ${payments.length ? `<div class="list">${payments.map((p) => {
        const tl = paymentTimeliness(q, p);
        return `
        <div class="qrow" style="grid-template-columns:1fr auto">
          <span class="client">${fmt(p.amountCents)} · ${esc(PAYMENT_METHOD_LABEL[p.method] || p.method)}${p.note ? ' · ' + esc(p.note) : ''}</span>
          <button class="x-btn" data-act="del-payment" data-id="${p.id}" aria-label="Eliminar pago">×</button>
          <span class="meta" style="display:flex;align-items:center;gap:6px">${dateStr(p.paidAt)}${tl ? statusChip(PAYMENT_TIMELINESS_PILL[tl], PAYMENT_TIMELINESS_LABEL[tl]) : ''}</span>
        </div>`;
      }).join('')}</div>` : ''}
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
          <div class="two-col">
            <div class="field"><label for="pay-date">Fecha del pago</label><input id="pay-date" name="date" type="date" value="${todayInputStr()}" max="${todayInputStr()}"></div>
            ${progress.length ? `<div class="field"><label for="pay-installment">Aplica a</label><select id="pay-installment" name="installment"><option value="">Automático</option>${progress.map((inst, i) => `<option value="${i + 1}">Parcialidad ${i + 1} (${fmt(inst.amountCents)})</option>`).join('')}</select></div>` : ''}
          </div>
          <div class="field"><label for="pay-note">Nota (opcional)</label><input id="pay-note" name="note"></div>
          <button class="btn primary block" type="submit">Registrar pago</button>
        </form>` : ''}
      ${(q.installmentHistory && q.installmentHistory.length) ? q.installmentHistory.map((h) => `
        <div class="section-h"><h2>Plan anterior · reemplazado el ${dateStr(h.replacedAt)}</h2></div>
        <div class="list muted">
          ${h.installments.slice().sort((a, b) => a.dueAt - b.dueAt).map((inst, i) => `
            <div class="qrow" style="grid-template-columns:1fr auto">
              <span class="client">Parcialidad ${i + 1} · ${fmt(inst.amountCents)}</span>
              <span class="meta">Vence ${dateStr(inst.dueAt)}</span>
            </div>`).join('')}
        </div>`).join('') : ''}
      <div class="section-h"><h2>Plan de parcialidades</h2></div>
      ${progress.length ? `
        <div class="list">
          ${progress.map((inst, i) => `
            <div class="qrow" style="grid-template-columns:1fr auto">
              <span class="client">Parcialidad ${i + 1} · ${fmt(inst.amountCents)}${inst.remaining > 0 && inst.allocated > 0 ? ` (faltan ${fmt(inst.remaining)})` : ''}</span>
              ${statusChip(INSTALLMENT_PILL[inst.timeliness], INSTALLMENT_LABEL[inst.timeliness])}
              <span class="meta">Vence ${dateStr(inst.dueAt)}</span>
            </div>`).join('')}
        </div>
        ${progress.reduce((s, i) => s + i.amountCents, 0) !== total && balance > 0 ? `
          <div class="banner media">
            <div class="head">! El total cambió</div>
            <p style="margin:0">El plan ya no cuadra con el total actual (${fmt(total)}). Reestructura las parcialidades que faltan con el saldo pendiente (${fmt(balance)}); las ya liquidadas se quedan como están.</p>
          </div>
          ${S.restructureOpen ? `
            <form class="stack" id="restructure-form">
              <div class="two-col">
                <div class="field"><label for="re-count">Número de parcialidades nuevas</label><input id="re-count" name="count" inputmode="numeric" class="num" value="2"></div>
                <div class="field"><label for="re-interval">Días entre cada una</label><input id="re-interval" name="interval" inputmode="numeric" class="num" value="30"></div>
              </div>
              <button class="btn primary block" type="submit">Reestructurar con el saldo pendiente (${fmt(balance)})</button>
            </form>
          ` : `<button class="btn block" data-act="restructure-open">Reestructurar plan</button>`}
        ` : ''}
        <button class="btn ghost danger block" data-act="clear-installments">Quitar plan de parcialidades</button>
        <label class="check-row" style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <input type="checkbox" id="show-installments-pdf" ${q.showInstallmentsOnPdf === false ? '' : 'checked'}>
          <span class="hint" style="margin:0">Mostrar el plan de parcialidades en el PDF del estado de cuenta</span>
        </label>
      ` : `
        <form class="stack" id="installments-form">
          <p class="hint">Divide el total en pagos programados para saber si cada abono llega a tiempo.</p>
          <div class="two-col">
            <div class="field"><label for="inst-count">Número de parcialidades</label><input id="inst-count" name="count" inputmode="numeric" class="num" value="3"></div>
            <div class="field"><label for="inst-interval">Días entre cada una</label><input id="inst-interval" name="interval" inputmode="numeric" class="num" value="30"></div>
          </div>
          <button class="btn block" type="submit">Generar plan</button>
        </form>
      `}
      <button class="btn primary block" data-act="share-receipt" style="margin-top:4px">${icon.share} Compartir estado de cuenta</button>
      <div class="two-col">
        <button class="btn" data-act="view-receipt">Ver PDF</button>
        <button class="btn" data-act="download-receipt">Descargar</button>
      </div>`;
  }

  /* ---------- cobranza: saldos pendientes de cobro ---------- */
  function pendingCollectionsQuotes() {
    return DB.getQuotes()
      .filter((q) => q.status === 'GENERADA' && isConfirmed(q) && balanceCentsOf(q) > 0)
      .sort((a, b) => {
        const av = isQuoteOverdue(a) ? 0 : 1;
        const bv = isQuoteOverdue(b) ? 0 : 1;
        return av !== bv ? av - bv : balanceCentsOf(b) - balanceCentsOf(a);
      });
  }
  function collectionsRows(pending) {
    return pending.length ? pending.map((q) => {
      const overdue = isQuoteOverdue(q);
      const dueChip = overdue
        ? statusChip('danger', 'Vencido')
        : paymentDueAt(q)
          ? statusChip(PAYMENT_DUE_PILL[paymentDueStatus(q)], PAYMENT_DUE_LABEL[paymentDueStatus(q)])
          : (q.installments && q.installments.length ? statusChip('info', 'Vigente') : '');
      return `
      <button class="qrow" data-act="open" data-id="${q.id}">
        <span class="client">${esc(q.client || 'Sin cliente')}</span>
        <span class="total num">${fmt(balanceCentsOf(q))}</span>
        <span class="meta"><span class="mono">${esc(q.folio || '—')}</span> · ${dateStr(q.updatedAt)}</span>
        <span style="display:flex;gap:6px;justify-self:end">
          ${statusChip(PAYMENT_PILL[paymentStatusOf(q)], PAYMENT_LABEL[paymentStatusOf(q)])}
          ${dueChip}
        </span>
      </button>`;
    }).join('') : '<div class="empty">No hay saldos pendientes. Todo lo cobrado está al día.</div>';
  }

  // Un renglón por cada cosa vencida (cada parcialidad vencida por
  // separado, o la cotización completa si no usa plan de parcialidades) —
  // el reporte de cobranza que se pidió, no solo el indicador por cotización.
  function overdueItemsReport() {
    const items = [];
    pendingCollectionsQuotes().forEach((q) => {
      const progress = installmentProgress(q);
      if (progress.length) {
        progress.forEach((p, i) => {
          if (p.timeliness === 'VENCIDA' || p.timeliness === 'PARCIAL_VENCIDA') {
            items.push({ quoteId: q.id, client: q.client || 'Sin cliente', folio: q.folio, label: `Parcialidad ${i + 1}`, amount: p.remaining, dueAt: p.dueAt });
          }
        });
      } else if (isQuoteOverdue(q)) {
        items.push({ quoteId: q.id, client: q.client || 'Sin cliente', folio: q.folio, label: 'Saldo total', amount: balanceCentsOf(q), dueAt: earliestOverdueDate(q) });
      }
    });
    return items.sort((a, b) => a.dueAt - b.dueAt);
  }

  // Agrupa lo vencido por cliente (uno puede tener varias parcialidades/cotizaciones
  // vencidas) para poder mandar un solo recordatorio de WhatsApp por cliente en vez
  // de uno por cada renglón del reporte.
  function overdueByClient() {
    const map = new Map();
    overdueItemsReport().forEach((it) => {
      const key = CAT.key(it.client);
      const cur = map.get(key) || { name: it.client, amount: 0 };
      cur.amount += it.amount;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }

  function viewCollections() {
    const pending = pendingCollectionsQuotes();
    const totalPending = pending.reduce((s, q) => s + balanceCentsOf(q), 0);
    const overdueItems = overdueItemsReport();
    const totalOverdue = overdueItems.reduce((s, it) => s + it.amount, 0);
    const daysLate = (dueAt) => Math.max(0, Math.floor((Date.now() - endOfDay(dueAt)) / 86400000));
    const reminders = overdueByClient();
    return `
      <header class="top">
        <button class="icon-btn" data-act="home" aria-label="Volver al inicio">${icon.back}</button>
        <div class="title">Cobranza</div>
      </header>
      <section class="summary">
        <div class="muted">Pendiente por cobrar</div>
        <div class="big num">${fmt(totalPending)}</div>
      </section>
      ${overdueItems.length ? `
        <div class="stat-pair">
          <div class="stat"><div class="lbl">Vencido</div><div class="val" style="color:var(--danger)">${fmt(totalOverdue)}</div></div>
          <div class="stat"><div class="lbl">Pagos/parcialidades vencidas</div><div class="val">${overdueItems.length}</div></div>
        </div>
        <div class="section-h"><h2>Reporte de vencidos</h2><button class="btn ghost" data-act="export-overdue-csv">Exportar CSV</button></div>
        <div class="list">
          ${overdueItems.map((it) => `
            <button class="qrow" data-act="open" data-id="${it.quoteId}">
              <span class="client">${esc(it.client)}</span>
              <span class="total num" style="color:var(--danger)">${fmt(it.amount)}</span>
              <span class="meta"><span class="mono">${esc(it.folio || '—')}</span> · ${it.label}</span>
              <span class="meta">Venció ${dateStr(it.dueAt)} · ${daysLate(it.dueAt)} día(s) de atraso</span>
            </button>`).join('')}
        </div>
      ` : ''}
      ${reminders.length ? `
        <div class="section-h"><h2>Recordatorios pendientes</h2></div>
        <p class="hint" style="margin-top:0">Un WhatsApp listo para mandar por cada cliente con algo vencido.</p>
        <div class="list">
          ${reminders.map((r) => {
            const cust = findCustomer(r.name);
            return `
            <div class="qrow" style="grid-template-columns:1fr auto">
              <span class="client">${esc(r.name)}</span>
              <span class="total num" style="color:var(--danger)">${fmt(r.amount)}</span>
              ${cust && cust.phone
                ? `<a class="btn primary" style="grid-column:1/-1" href="${waReminderLink(cust, customerInfo(r.name).debt, r.amount)}" target="_blank" rel="noopener">${icon.share} Recordar por WhatsApp</a>`
                : `<span class="meta" style="grid-column:1/-1">Sin teléfono guardado — agrégalo en la ficha del cliente</span>`}
            </div>`;
          }).join('')}
        </div>
      ` : ''}
      <div class="section-h"><h2>Todo lo pendiente</h2></div>
      <div class="list">${collectionsRows(pending)}</div>`;
  }

  /* ---------- reportes: ventas y cobros por mes, mejores clientes ---------- */
  function monthKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  }
  function viewReports() {
    const quotes = DB.getQuotes().filter((q) => q.status === 'GENERADA' && !isRejected(q));
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1).getTime()));
    const byMonth = Object.fromEntries(months.map((k) => [k, { cotizado: 0, cobrado: 0 }]));
    quotes.forEach((q) => {
      const k = monthKey(q.generatedAt || q.updatedAt);
      if (byMonth[k]) byMonth[k].cotizado += totalsOf(q).total;
      (q.payments || []).forEach((p) => {
        const pk = monthKey(p.paidAt);
        if (byMonth[pk]) byMonth[pk].cobrado += p.amountCents;
      });
    });
    const maxVal = Math.max(1, ...months.map((k) => Math.max(byMonth[k].cotizado, byMonth[k].cobrado)));
    const byClient = new Map();
    quotes.filter(isConfirmed).forEach((q) => {
      const name = q.client || 'Sin cliente';
      const cur = byClient.get(name) || { total: 0, count: 0 };
      cur.total += totalsOf(q).total;
      cur.count += 1;
      byClient.set(name, cur);
    });
    const topClients = Array.from(byClient.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total).slice(0, 5);
    return `
      <header class="top">
        <button class="icon-btn" data-act="home" aria-label="Volver al inicio">${icon.back}</button>
        <div class="title">Reportes</div>
      </header>
      <div class="section-h"><h2>Últimos 6 meses</h2></div>
      <div class="sheet">
        ${months.map((k) => `
          <div style="margin-bottom:10px">
            <div class="row" style="justify-content:space-between;font-size:13px"><b style="text-transform:capitalize">${monthLabel(k)}</b><span class="muted">${fmt(byMonth[k].cotizado)} cotizado · ${fmt(byMonth[k].cobrado)} cobrado</span></div>
            <div style="display:flex;gap:3px;height:8px;margin-top:4px">
              <div style="flex:${byMonth[k].cotizado / maxVal};background:var(--accent);border-radius:3px;min-width:2px"></div>
              <div style="flex:${byMonth[k].cobrado / maxVal};background:var(--ok);border-radius:3px;min-width:2px"></div>
            </div>
          </div>`).join('')}
        <p class="hint" style="margin:0">■ Cotizado &nbsp; ■ Cobrado</p>
      </div>
      <div class="section-h"><h2>Mejores clientes</h2></div>
      <div class="list">
        ${topClients.length ? topClients.map((c) => `
          <div class="qrow" style="grid-template-columns:1fr auto">
            <span class="client">${esc(c.name)}</span>
            <span class="total num">${fmt(c.total)}</span>
            <span class="meta">${c.count} cotización(es) confirmada(s)</span>
          </div>`).join('') : '<div class="empty">Aún no hay cotizaciones confirmadas.</div>'}
      </div>`;
  }

  /* ---------- base de clientes (V0.4.3, opcional) ---------- */
  function viewClients() {
    const rows = S.customers
      .map((c) => Object.assign({ info: customerInfo(c.name) }, c))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return `
      <header class="top">
        <button class="icon-btn" data-act="home" aria-label="Volver al inicio">${icon.back}</button>
        <div class="title">Clientes</div>
      </header>
      <div class="stack">
        <form class="row" id="customer-form">
          <input id="c-name" name="name" placeholder="Nombre del cliente" style="flex:1" required>
          <button class="btn primary" type="submit">+ Agregar</button>
        </form>
        <p class="hint">Guardar un cliente es opcional: siempre puedes cotizar a cualquiera sin guardarlo. Guárdalos para ver quién te debe y quién es recurrente.</p>
        <div class="list">
          ${rows.length ? rows.map((c) => `
            <button class="qrow" data-act="open-client" data-id="${c.id}">
              <span class="client">${esc(c.name)}</span>
              <span class="total num">${c.info.debt > 0 ? fmt(c.info.debt) : ''}</span>
              <span class="meta">${c.info.quotes.length} cotización(es) generada(s)</span>
              ${c.info.moroso ? statusChip('danger', 'Moroso') : c.info.debt > 0 ? statusChip('draft', 'Debe') : statusChip('done', 'Al corriente')}
            </button>`).join('') : '<div class="empty">Aún no guardas clientes. Agrega uno arriba, o guarda uno desde una cotización.</div>'}
        </div>
      </div>`;
  }

  function viewClientDetail() {
    const c = S.activeCustomer;
    const info = customerInfo(c.name);
    const quotes = info.quotes.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const confirmedQuotes = quotes.filter(isConfirmed);
    const overdueCents = overdueItemsReport()
      .filter((it) => CAT.key(it.client) === CAT.key(c.name))
      .reduce((s, it) => s + it.amount, 0);
    return `
      <header class="top">
        <button class="icon-btn" data-act="clients" aria-label="Volver a clientes">${icon.back}</button>
        <div class="title">${esc(c.name)}</div>
      </header>
      <section class="summary">
        <div class="muted">${info.moroso ? '⚠ Cliente moroso: tiene pagos vencidos' : info.debt > 0 ? 'Tiene saldo pendiente' : 'Al corriente'}</div>
        <div class="big num">${fmt(info.debt)}</div>
      </section>
      ${info.debt > 0 && c.phone ? `<a class="btn primary block" href="${waReminderLink(c, info.debt, overdueCents)}" target="_blank" rel="noopener">${icon.share} Recordar por WhatsApp</a>` : ''}
      ${confirmedQuotes.length > 1 ? `
        <button class="btn primary block" data-act="client-statement">Ver estado de cuenta completo (${confirmedQuotes.length} cotizaciones)</button>
      ` : ''}
      <div class="section-h"><h2>Datos de contacto</h2></div>
      <form class="stack" id="customer-edit-form">
        <div class="two-col">
          <div class="field"><label for="cc-phone">Teléfono (WhatsApp)</label><input id="cc-phone" name="phone" type="tel" value="${esc(c.phone || '')}" placeholder="10 dígitos"></div>
          <div class="field"><label for="cc-notes">Notas</label><input id="cc-notes" name="notes" value="${esc(c.notes || '')}" placeholder="Ej. prefiere transferencia"></div>
        </div>
        <button class="btn block" type="submit">Guardar datos</button>
      </form>
      <div class="section-h"><h2>Cotizaciones generadas</h2></div>
      <div class="list">
        ${quotes.length ? quotes.map((q) => `
          <button class="qrow" data-act="open" data-id="${q.id}">
            <span class="client"><span class="mono">${esc(q.folio || '—')}</span></span>
            <span class="total num">${fmt(balanceCentsOf(q))}</span>
            <span class="meta">${dateStr(q.updatedAt)}</span>
            ${isConfirmed(q) ? statusChip(PAYMENT_PILL[paymentStatusOf(q)], PAYMENT_LABEL[paymentStatusOf(q)]) : q.confirmation === 'RECHAZADA' ? statusChip('danger', 'Rechazada') : statusChip('info', 'Por confirmar')}
          </button>`).join('') : '<div class="empty">Sin cotizaciones generadas todavía.</div>'}
      </div>
      <div class="stack" style="margin-top:20px">
        <button class="btn ghost danger block" data-act="delete-client">Quitar de clientes guardados</button>
      </div>`;
  }

  // Estado de cuenta combinado de un cliente: junta todas sus cotizaciones ya
  // confirmadas (una por una siguen teniendo su propio PDF detallado; este es
  // el resumen de conjunto que se pidió para cuando hay varias).
  function viewClientStatement() {
    const c = S.activeCustomer;
    const quotes = customerInfo(c.name).quotes.filter(isConfirmed).sort((a, b) => (b.generatedAt || b.updatedAt) - (a.generatedAt || a.updatedAt));
    const totalAll = quotes.reduce((s, q) => s + totalsOf(q).total, 0);
    const paidAll = quotes.reduce((s, q) => s + paidCentsOf(q), 0);
    const saldoAll = Math.max(0, totalAll - paidAll);
    return `
      <header class="top">
        <button class="icon-btn" data-act="open-client" data-id="${c.id}" aria-label="Volver al cliente">${icon.back}</button>
        <div class="title">${esc(c.name)}</div>
      </header>
      <section class="summary">
        <div class="muted">Estado de cuenta completo · ${quotes.length} cotizaciones</div>
        <div class="big num">${fmt(saldoAll)}</div>
        <div class="muted" style="font-size:14px">de ${fmt(totalAll)} cotizado, ${fmt(paidAll)} pagado</div>
      </section>
      <div class="stack">
        <button class="btn primary block" data-act="share-client-statement">${icon.share} Compartir estado de cuenta</button>
        <div class="two-col">
          <button class="btn" data-act="view-client-statement">Ver PDF</button>
          <button class="btn" data-act="download-client-statement">Descargar</button>
        </div>
        <div class="list">
          ${quotes.map((q) => `
            <button class="qrow" data-act="open" data-id="${q.id}">
              <span class="client"><span class="mono">${esc(q.folio || '—')}</span></span>
              <span class="total num">${fmt(balanceCentsOf(q))}</span>
              <span class="meta">${dateStr(q.generatedAt || q.updatedAt)}</span>
              ${statusChip(PAYMENT_PILL[paymentStatusOf(q)], PAYMENT_LABEL[paymentStatusOf(q)])}
            </button>`).join('')}
        </div>
      </div>`;
  }

  // CSV con BOM (para que Excel detecte acentos bien) y comillas dobladas
  // donde haga falta, sin librerías externas.
  function downloadCsv(rows, filename) {
    const csvField = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const text = '﻿' + rows.map((r) => r.map(csvField).join(',')).join('\r\n');
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    SHARE.download(blob, filename);
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
        <div class="field"><label for="s-payterm">Plazo de pago predeterminado (días, 0 = de contado)</label><input id="s-payterm" name="paymentTermDays" inputmode="numeric" value="${esc(s.paymentTermDays || 0)}"></div>
        <div class="field">
          <label for="s-homelist">Qué ver primero en el inicio</label>
          <select id="s-homelist" name="homeList">
            <option value="quotes" ${s.homeList !== 'collections' ? 'selected' : ''}>Cotizaciones recientes</option>
            <option value="collections" ${s.homeList === 'collections' ? 'selected' : ''}>Pendientes por cobrar</option>
          </select>
        </div>
        <div class="section-h"><h2>Diseño del PDF</h2></div>
        <div class="two-col">
          <div class="field"><label for="s-pdfaccent">Color de tu marca</label><input id="s-pdfaccent" name="pdfAccent" type="color" value="${esc(s.pdfAccent || '#2743b8')}" style="width:100%;height:46px;padding:4px"></div>
          <div class="field">
            <label for="s-showrfc" style="display:flex;align-items:center;gap:8px;text-transform:none;font-weight:500;color:var(--ink);letter-spacing:0;min-height:46px">
              <input id="s-showrfc" name="showRfcOnPdf" type="checkbox" ${s.showRfcOnPdf !== false ? 'checked' : ''} style="width:20px;height:20px;flex:none">
              Mostrar RFC en el PDF
            </label>
          </div>
        </div>
        <div class="field"><label for="s-cond">Condiciones predeterminadas</label><textarea id="s-cond" name="conditions">${esc(s.conditions)}</textarea></div>
        <p class="hint">Productos recordados: ${S.catalog.length}. ${cloudOn && S.cloudSession ? 'Tus datos se guardan en tu cuenta.' : 'Tus cotizaciones y datos se guardan solo en este dispositivo.'}</p>
        <button class="btn primary block" type="submit">Guardar</button>
      </form>
      ${cloudOn && S.cloudSession ? `
        <div class="section-h"><h2>Cuenta</h2></div>
        <div class="stack">
          <p class="hint">Sesión iniciada como ${esc(S.cloudSession.user.email)}</p>
          ${pendingSyncQuotes().length ? `
            <div class="banner media">
              <div class="head">${pendingSyncQuotes().length} cotización(es) sin sincronizar</div>
              <p style="margin:0">Están guardadas en este dispositivo, pero aún no en tu cuenta. No se pierden, pero conviene sincronizarlas antes de borrar datos del navegador o cambiar de teléfono.</p>
            </div>
            <button class="btn primary block" data-act="resync-pending" ${S.authBusy ? 'disabled' : ''}>${S.authBusy ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
          ` : ''}
          <button class="btn block" data-act="support-home">Soporte</button>
          <button class="btn block ghost danger" data-act="logout">Cerrar sesión</button>
        </div>` : `
        <div class="section-h"><h2>Soporte</h2></div>
        <div class="stack">
          <p class="hint">¿Algo no funciona bien o tienes una sugerencia? Puedes avisarnos aunque no hayas iniciado sesión.</p>
          <button class="btn block" data-act="feedback-open">Enviar mensaje</button>
        </div>`}
      <div class="section-h"><h2>Exportar a Excel/CSV</h2></div>
      <div class="stack">
        <p class="hint">Archivos que puedes abrir directo en Excel o pasarle a tu contador.</p>
        <div class="two-col">
          <button class="btn block" data-act="export-quotes-csv">Cotizaciones</button>
          <button class="btn block" data-act="export-payments-csv">Pagos</button>
        </div>
        <button class="btn block" data-act="export-clients-csv">Clientes</button>
      </div>
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

  // Color "de marca" más frecuente en el logo: se ignoran blancos, negros y
  // grises casi puros (casi siempre son el fondo o el texto, no la marca) y
  // los pixeles transparentes; de lo que queda, se agrupa por tonos
  // parecidos y se usa el grupo más común. Si el logo es puro blanco/negro
  // (sin color), no se sugiere nada y se deja el color que ya había.
  function detectLogoColor(canvas) {
    const ctx = canvas.getContext('2d');
    let data;
    try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; } catch (e) { return null; }
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 235 && min > 215) continue; // casi blanco
      if (max < 25) continue; // casi negro
      if (max - min < 18) continue; // gris (poco saturado)
      const key = [Math.round(r / 24), Math.round(g / 24), Math.round(b / 24)].join(',');
      const entry = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      entry.count++; entry.r += r; entry.g += g; entry.b += b;
      buckets.set(key, entry);
    }
    let best = null;
    buckets.forEach((v) => { if (!best || v.count > best.count) best = v; });
    if (!best) return null;
    const toHex = (n) => Math.round(n / best.count).toString(16).padStart(2, '0');
    return '#' + toHex(best.r) + toHex(best.g) + toHex(best.b);
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
        const detected = detectLogoColor(c);
        if (detected) S.settings.pdfAccent = detected;
        DB.saveSettings(S.settings);
        render();
        toast(detected ? 'Logo guardado y color de marca detectado (puedes cambiarlo abajo)' : 'Logo guardado');
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
      case 'reports': return go('reports');
      case 'clients': S.customers = DB.getCustomers(); return go('clients');
      case 'open-client': S.activeCustomer = S.customers.find((c) => c.id === b.dataset.id); return go('client-detail');
      case 'delete-client': {
        const key = CAT.key(S.activeCustomer.name);
        S.customers = S.customers.filter((c) => c.id !== S.activeCustomer.id);
        DB.saveCustomers(S.customers);
        if (cloudOn && S.cloudBusiness) CLOUD.data.deleteCustomer(S.cloudBusiness.id, key).catch(() => {});
        toast('Cliente eliminado de guardados');
        return go('clients');
      }
      case 'save-client': {
        if (!S.quote.client) return toast('Escribe el nombre del cliente primero.');
        if (saveCustomer(S.quote.client)) toast('Cliente guardado');
        else toast('Ese cliente ya está guardado.');
        return render();
      }
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
      case 'save': {
        // Si ya estaba generada (con folio enviado al cliente, tal vez ya con
        // pagos), "Guardar" solo debe guardar el cambio, no regresarla a
        // borrador: eso la sacaba de Cobranza, del pendiente por cobrar y de
        // la deuda del cliente aunque sus pagos siguieran ahí.
        const wasGenerated = q.status === 'GENERADA';
        persist(wasGenerated ? 'GENERADA' : 'BORRADOR');
        toast(wasGenerated ? 'Cambios guardados · ' + q.folio : 'Borrador guardado · ' + q.folio);
        return go(wasGenerated ? 'summary' : 'home');
      }
      case 'generate': {
        const err = validate(q);
        if (err) { render(); return toast(err); }
        persist('GENERADA');
        return go('summary');
      }
      case 'confirm-quote': {
        q.confirmation = 'CONFIRMADA';
        savePaymentsChange(q);
        toast('Cotización confirmada');
        return render();
      }
      case 'reject-quote': {
        q.confirmation = 'RECHAZADA';
        savePaymentsChange(q);
        toast('Cotización marcada como rechazada');
        return render();
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
      case 'clear-installments': {
        q.installments = [];
        q.installmentHistory = [];
        savePaymentsChange(q);
        toast('Plan de parcialidades eliminado');
        return render();
      }
      case 'restructure-open': S.restructureOpen = true; return render();
      case 'add-product-open': S.addProductOpen = true; render(); return document.getElementById('add-product-text').focus();
      case 'add-product-voice':
        if (!VOICE.supported()) return toast('Este navegador no tiene dictado. Escríbelo directamente.');
        return dictate((text) => {
          if (!text) return toast('No se escuchó nada.');
          const ta = document.getElementById('add-product-text');
          if (ta) ta.value = text;
        });
      case 'support-desc-voice':
      case 'feedback-desc-voice': {
        if (!VOICE.supported()) return toast('Este navegador no tiene dictado. Escríbelo directamente.');
        const id = act === 'support-desc-voice' ? 't-desc' : 'fb-desc';
        return dictate((text) => {
          if (!text) return toast('No se escuchó nada.');
          const ta = document.getElementById(id);
          if (ta) ta.value = ta.value ? ta.value + ' ' + text : text;
        });
      }
      case 'add-product-submit': {
        if (b.disabled) return;
        const text = document.getElementById('add-product-text').value.trim();
        if (!text) return toast('Escribe o dicta el producto primero.');
        b.disabled = true;
        return addProductsToQuote(text);
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
      case 'view-receipt': {
        const blob = makePdf('estado');
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        if (!window.open(url, '_blank')) location.href = url;
        return;
      }
      case 'download-receipt': {
        const blob = makePdf('estado');
        if (blob) SHARE.download(blob, PDF.filename(q, 'estado'));
        return;
      }
      case 'client-statement': return go('client-statement');
      case 'share-client-statement': {
        const cu = S.activeCustomer;
        const quotes = customerInfo(cu.name).quotes.filter(isConfirmed);
        const blob = PDF.clientStatementBlob(cu.name, quotes, S.settings);
        const r = await SHARE.sharePdf(blob, PDF.clientStatementFilename(cu.name), 'Estado de cuenta de ' + cu.name, `Estado de cuenta de ${cu.name}: ${quotes.length} cotizaciones`);
        if (r === 'downloaded') toast('Tu navegador no permite compartir archivos; se descargó el PDF.');
        return;
      }
      case 'view-client-statement': {
        const cu = S.activeCustomer;
        const quotes = customerInfo(cu.name).quotes.filter(isConfirmed);
        const blob = PDF.clientStatementBlob(cu.name, quotes, S.settings);
        const url = URL.createObjectURL(blob);
        if (!window.open(url, '_blank')) location.href = url;
        return;
      }
      case 'download-client-statement': {
        const cu = S.activeCustomer;
        const quotes = customerInfo(cu.name).quotes.filter(isConfirmed);
        const blob = PDF.clientStatementBlob(cu.name, quotes, S.settings);
        SHARE.download(blob, PDF.clientStatementFilename(cu.name));
        return;
      }
      case 'logo-remove': S.settings.logo = ''; DB.saveSettings(S.settings); return render();
      case 'export-quotes-csv': {
        const rows = [['Folio', 'Cliente', 'Fecha', 'Estado', 'Confirmación', 'Total', 'Pagado', 'Saldo']];
        DB.getQuotes().filter((q) => q.status === 'GENERADA').forEach((q) => {
          const conf = q.confirmation === 'RECHAZADA' ? 'Rechazada' : q.confirmation === 'CONFIRMADA' ? 'Confirmada' : q.confirmation === null ? 'Por confirmar' : 'Confirmada';
          rows.push([q.folio || '', q.client || '', dateStr(q.generatedAt || q.updatedAt), q.status, conf, M.centsToStr(totalsOf(q).total), M.centsToStr(paidCentsOf(q)), M.centsToStr(balanceCentsOf(q))]);
        });
        downloadCsv(rows, 'cotizaciones.csv');
        return;
      }
      case 'export-payments-csv': {
        const rows = [['Folio', 'Cliente', 'Fecha de pago', 'Monto', 'Método', 'Nota']];
        DB.getQuotes().forEach((q) => (q.payments || []).forEach((p) => {
          rows.push([q.folio || '', q.client || '', dateStr(p.paidAt), M.centsToStr(p.amountCents), PAYMENT_METHOD_LABEL[p.method] || p.method, p.note || '']);
        }));
        downloadCsv(rows, 'pagos.csv');
        return;
      }
      case 'export-clients-csv': {
        const rows = [['Nombre', 'Teléfono', 'Notas', 'Deuda actual']];
        S.customers.forEach((c) => rows.push([c.name, c.phone || '', c.notes || '', M.centsToStr(customerInfo(c.name).debt)]));
        downloadCsv(rows, 'clientes.csv');
        return;
      }
      case 'export-overdue-csv': {
        const rows = [['Cliente', 'Folio', 'Concepto', 'Monto vencido', 'Venció el']];
        overdueItemsReport().forEach((it) => rows.push([it.client, it.folio || '', it.label, M.centsToStr(it.amount), dateStr(it.dueAt)]));
        downloadCsv(rows, 'vencidos.csv');
        return;
      }
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
      case 'auth': return go('auth');
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
        const { failed } = await importLocalDataToCloud(S.cloudBusiness.id);
        DB.setImportDecided();
        S.authBusy = false;
        if (failed) toast(`Se importó lo posible; ${failed} elemento(s) no se pudieron subir. Puedes reintentar desde Configuración, tus datos siguen guardados en este dispositivo.`);
        else toast('Datos importados a tu cuenta');
        await pullAndMerge();
        return go('home');
      }
      case 'resync-pending': {
        S.authBusy = true;
        render();
        const { failed, total } = await importLocalDataToCloud(S.cloudBusiness.id);
        S.authBusy = false;
        if (!total) toast('No hay nada pendiente por sincronizar.');
        else if (failed) toast(`${total - failed} de ${total} sincronizados; ${failed} siguen pendientes (revisa tu conexión e inténtalo de nuevo).`);
        else toast('Todo sincronizado con tu cuenta');
        await pullAndMerge();
        return render();
      }
      case 'import-no': {
        DB.setImportDecided();
        await pullAndMerge();
        return go('home');
      }
      case 'support-home': return openSupportHome();
      case 'support-new': return go('support-new');
      case 'feedback-open': return go('feedback');
      case 'support-open': return openSupportTicket(b.dataset.id);
    }
  });

  app.addEventListener('input', (e) => {
    if (S.view === 'editor') onEditorInput(e);
    if (e.target.id === 'home-search') { S.homeSearch = e.target.value; refreshHomeSearch(); }
  });
  app.addEventListener('change', (e) => {
    if (S.view === 'editor') onEditorChange(e);
    if (e.target.id === 's-logo' && e.target.files[0]) readLogo(e.target.files[0]);
    if (e.target.id === 'backup-file' && e.target.files[0]) readBackupFile(e.target.files[0]);
    if (e.target.id === 'show-installments-pdf') {
      const q = S.quote;
      q.showInstallmentsOnPdf = e.target.checked;
      savePaymentsChange(q);
    }
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
      s.paymentTermDays = parseInt(f.get('paymentTermDays'), 10) || 0;
      s.pdfAccent = String(f.get('pdfAccent') || '#2743b8').trim();
      s.showRfcOnPdf = f.get('showRfcOnPdf') === 'on';
      s.homeList = f.get('homeList') === 'collections' ? 'collections' : 'quotes';
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
      const imageFile = document.getElementById('t-image').files[0] || null;
      try {
        const t = await CLOUD.support.create(S.cloudBusiness.id, S.cloudSession.user.id, subject, description, imageFile);
        toast('Solicitud enviada');
        S.tickets = [t, ...S.tickets];
        return openSupportTicket(t.id);
      } catch (err) {
        return toast(err.message);
      }
    }

    if (e.target.id === 'feedback-form') {
      const subject = String(f.get('subject') || '').trim();
      const description = String(f.get('description') || '').trim();
      const contact = String(f.get('contact') || '').trim();
      if (!subject) return toast('Escribe un asunto.');
      if (!cloudOn) return toast('Esta app no tiene conexión configurada; no se puede enviar en este momento.');
      const imageFile = document.getElementById('fb-image').files[0] || null;
      try {
        await CLOUD.support.createAnonymous(subject, description, contact, imageFile);
        toast('Mensaje enviado, gracias');
        return go(S.cloudSession ? 'settings' : 'auth');
      } catch (err) {
        return toast(err.message);
      }
    }

    if (e.target.id === 'payment-form') {
      const amountCents = M.toCents(f.get('amount'));
      if (!amountCents || amountCents <= 0) return toast('Escribe un monto válido.');
      const method = String(f.get('method') || 'efectivo');
      let note = String(f.get('note') || '').trim();
      const installmentNum = parseInt(f.get('installment'), 10);
      if (installmentNum > 0) note = `[Parcialidad ${installmentNum}] ${note}`.trim();
      const dateInput = String(f.get('date') || '').trim();
      const paidAt = dateInput ? new Date(dateInput + 'T12:00:00').getTime() : Date.now();
      const q = S.quote;
      q.payments = q.payments || [];
      q.payments.unshift({ id: pid(), amountCents, method, note, paidAt: Number.isFinite(paidAt) ? paidAt : Date.now() });
      savePaymentsChange(q);
      toast('Pago registrado');
      return render();
    }

    if (e.target.id === 'installments-form') {
      const count = Math.max(1, Math.min(24, parseInt(f.get('count'), 10) || 1));
      const interval = Math.max(1, parseInt(f.get('interval'), 10) || 1);
      const q = S.quote;
      const total = totalsOf(q).total;
      const base = q.generatedAt || q.updatedAt || Date.now();
      let assigned = 0;
      const installments = [];
      for (let i = 0; i < count; i++) {
        const amt = i === count - 1 ? total - assigned : Math.floor(total / count);
        assigned += amt;
        installments.push({ id: pid(), dueAt: base + interval * (i + 1) * 86400000, amountCents: amt });
      }
      q.installments = installments;
      savePaymentsChange(q);
      toast('Plan de parcialidades generado');
      return render();
    }

    if (e.target.id === 'restructure-form') {
      const count = Math.max(1, Math.min(24, parseInt(f.get('count'), 10) || 1));
      const interval = Math.max(1, parseInt(f.get('interval'), 10) || 1);
      const q = S.quote;
      if (restructurePlan(q, count, interval)) {
        savePaymentsChange(q);
        toast('Plan reestructurado con el saldo pendiente');
      }
      S.restructureOpen = false;
      return render();
    }

    if (e.target.id === 'customer-form') {
      const name = String(f.get('name') || '').trim();
      if (!name) return;
      if (saveCustomer(name)) toast('Cliente agregado');
      else toast('Ese cliente ya existe.');
      return render();
    }

    if (e.target.id === 'customer-edit-form') {
      updateCustomer(S.activeCustomer.id, { phone: String(f.get('phone') || '').trim(), notes: String(f.get('notes') || '').trim() });
      S.activeCustomer = S.customers.find((c) => c.id === S.activeCustomer.id);
      toast('Datos guardados');
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
      'support-list': viewSupportList, 'support-new': viewSupportNew, 'support-ticket': viewSupportTicket, feedback: viewFeedback,
      collections: viewCollections, reports: viewReports, clients: viewClients, 'client-detail': viewClientDetail, 'client-statement': viewClientStatement,
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

  // Si se recupera la conexión, se reintenta solo lo que haya quedado
  // pendiente (nunca se importó, o falló al sincronizar una edición) sin que
  // el usuario tenga que acordarse de entrar a Configuración.
  window.addEventListener('online', async () => {
    if (!(cloudOn && S.cloudBusiness)) return;
    if (!pendingSyncQuotes().length) return;
    try {
      const { failed, total } = await importLocalDataToCloud(S.cloudBusiness.id);
      if (!failed) toast(`${total} cotización(es) sincronizada(s) automáticamente`);
      if (S.view === 'settings') render();
    } catch (e) { /* sin red todavía de verdad: se reintentará la próxima vez */ }
  });

  boot();
})();
