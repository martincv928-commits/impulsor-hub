/* QuoteFlow Admin: consola del propietario de la plataforma.
 * Ninguna acción sensible ocurre aquí: este archivo solo llama a las
 * funciones admin_* de la base de datos, que verifican por su cuenta que
 * quien llama es un administrador real (ver supabase/schema_v0.3.1.sql). */
(function () {
  'use strict';
  const CLOUD = window.QF.cloud;
  const QFA = window.QFA;
  const app = document.getElementById('app');

  if (!CLOUD.enabled()) {
    app.innerHTML = '<div class="hero"><p>QuoteFlow Admin no está configurado.</p></div>';
    return;
  }

  const S = {
    view: 'loading', session: null, isAdmin: false, authBusy: false,
    stats: null, businesses: [], search: '',
    business: null, businessStats: null, members: [],
    tickets: [], ticket: null, messages: [],
    audit: [],
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateStr = (v) => (v ? new Date(v).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const back = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3500);
  }

  function go(view) {
    S.view = view;
    render();
    window.scrollTo(0, 0);
  }

  const STATUS_LABEL = { TRIAL: 'Prueba', ACTIVE: 'Activo', PAST_DUE: 'Pago vencido', SUSPENDED: 'Suspendido', CANCELLED: 'Cancelado' };
  const statusPill = (s) => `<span class="pill ${s === 'ACTIVE' ? 'done' : s === 'SUSPENDED' || s === 'CANCELLED' ? '' : 'draft'}" style="${s === 'SUSPENDED' || s === 'CANCELLED' ? 'background:var(--danger);color:#fff' : ''}">${STATUS_LABEL[s] || s}</span>`;
  const TICKET_LABEL = { OPEN: 'Abierto', IN_PROGRESS: 'En proceso', WAITING_CUSTOMER: 'Espera cliente', RESOLVED: 'Resuelto', CLOSED: 'Cerrado' };
  const ticketDone = (t) => t.status === 'RESOLVED' || t.status === 'CLOSED';

  /* ---------- vistas ---------- */

  function nav(active) {
    const items = [['dashboard', 'Panel'], ['businesses', 'Negocios'], ['tickets', 'Soporte'], ['audit', 'Auditoría']];
    return `<div class="seg" role="group" aria-label="Secciones">${items.map(([k, l]) => `<button data-act="nav" data-v="${k}" aria-pressed="${active === k}">${l}</button>`).join('')}</div>`;
  }

  function viewLoading() {
    return '<div class="hero"><p class="muted">Cargando…</p></div>';
  }

  function viewAuth() {
    return `
      <div class="hero" style="padding-top:14px"><div class="brand">QuoteFlow<small>Admin</small></div></div>
      <form class="stack" id="auth-form">
        <div class="field"><label for="a-email">Correo</label><input id="a-email" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label for="a-pass">Contraseña</label><input id="a-pass" name="password" type="password" required autocomplete="current-password"></div>
        <button class="btn primary block" type="submit" ${S.authBusy ? 'disabled' : ''}>${S.authBusy ? 'Un momento…' : 'Entrar'}</button>
      </form>`;
  }

  function viewNotAdmin() {
    return `
      <div class="hero" style="padding-top:14px"><div class="brand">QuoteFlow<small>Admin</small></div></div>
      <div class="stack">
        <p>Esta cuenta (${esc(S.session.user.email)}) no tiene permisos de administrador de la plataforma.</p>
        <button class="btn block" data-act="logout">Cerrar sesión</button>
      </div>`;
  }

  function viewDashboard() {
    const s = S.stats;
    const tile = (n, l) => `<div class="card" style="align-items:center;text-align:center"><div class="totals t" style="font-size:26px">${n}</div><div class="hint">${l}</div></div>`;
    return `
      <header class="top"><div class="brand">QuoteFlow<small>Admin</small></div></header>
      ${nav('dashboard')}
      <div class="two-col" style="margin-top:14px">
        ${tile(s.businesses_total, 'Negocios totales')}
        ${tile(s.businesses_active, 'Activos')}
        ${tile(s.businesses_trial, 'En prueba')}
        ${tile(s.businesses_suspended, 'Suspendidos')}
        ${tile(s.users_total, 'Usuarios')}
        ${tile(s.quotes_total, 'Cotizaciones')}
      </div>
      ${s.tickets_open ? `<div class="banner media" style="margin-top:14px"><div class="head">${s.tickets_open} ticket(s) de soporte abiertos</div></div>` : ''}
      <div class="section-h"><h2>Negocios recientes</h2></div>
      <div class="list">${s.recent_businesses.map((b) => `
        <button class="qrow" data-act="open-business" data-id="${b.id}">
          <span class="client">${esc(b.name || '(sin nombre)')}</span>
          ${statusPill(b.status)}
          <span class="meta">${b.plan} · ${dateStr(b.created_at)}</span>
        </button>`).join('') || '<div class="empty">Aún no hay negocios.</div>'}</div>
      <div class="section-h"><h2>Actividad administrativa reciente</h2></div>
      <div class="sheet">${s.recent_actions.length ? s.recent_actions.map((a) => `<div class="row" style="justify-content:space-between"><span>${esc(a.action)}</span><span class="hint">${dateStr(a.created_at)}</span></div>`).join('') : '<span class="hint">Sin acciones todavía.</span>'}</div>`;
  }

  function viewBusinesses() {
    return `
      <header class="top"><div class="brand">QuoteFlow<small>Admin</small></div></header>
      ${nav('businesses')}
      <div class="field" style="margin-top:14px"><input id="biz-search" placeholder="Buscar por nombre o correo del dueño" value="${esc(S.search)}"></div>
      <div class="list">${S.businesses.map((b) => `
        <button class="qrow" data-act="open-business" data-id="${b.id}">
          <span class="client">${esc(b.name || '(sin nombre)')}</span>
          ${statusPill(b.status)}
          <span class="meta">${esc(b.owner_email || '—')} · ${b.plan} · ${b.members_count} usuario(s) · ${b.quotes_count} cotización(es)</span>
        </button>`).join('') || '<div class="empty">Sin resultados.</div>'}</div>`;
  }

  function viewBusiness() {
    const b = S.business;
    const bs = S.businessStats;
    return `
      <header class="top">
        <button class="icon-btn" data-act="nav" data-v="businesses" aria-label="Volver a negocios">${back}</button>
        <div class="title">${esc(b.name || '(sin nombre)')}</div>
        <span class="spacer"></span>
        ${statusPill(b.status)}
      </header>
      <div class="stack">
        <div class="sheet">
          <div class="row" style="justify-content:space-between"><span class="hint">ID</span><span class="mono" style="font-size:12px">${b.id}</span></div>
          <div class="row" style="justify-content:space-between"><span class="hint">Dueño</span><span>${esc(b.owner_email || '—')}</span></div>
          <div class="row" style="justify-content:space-between"><span class="hint">Alta</span><span>${dateStr(b.created_at)}</span></div>
          <div class="row" style="justify-content:space-between"><span class="hint">Vencimiento</span><span>${dateStr(b.plan_renews_at)}</span></div>
          <div class="row" style="justify-content:space-between"><span class="hint">Usuarios</span><span>${bs.members_count}</span></div>
          <div class="row" style="justify-content:space-between"><span class="hint">Cotizaciones (generadas)</span><span>${bs.quotes_count} (${bs.quotes_generated})</span></div>
          <div class="row" style="justify-content:space-between"><span class="hint">Productos en catálogo</span><span>${bs.products_count}</span></div>
        </div>

        <div class="lbl">Plan</div>
        <div class="seg" role="group">${['FREE', 'BASIC', 'PRO'].map((p) => `<button data-act="set-plan" data-v="${p}" aria-pressed="${b.plan === p}">${p}</button>`).join('')}</div>

        <div class="lbl">Estado</div>
        <div class="two-col">
          <button class="btn" data-act="set-status" data-v="ACTIVE">Activar</button>
          <button class="btn danger" data-act="set-status" data-v="SUSPENDED">Suspender</button>
          <button class="btn" data-act="set-status" data-v="TRIAL">Marcar en prueba</button>
          <button class="btn ghost danger" data-act="set-status" data-v="CANCELLED">Cancelar</button>
        </div>

        <div class="field"><label for="biz-renewal">Vencimiento (AAAA-MM-DD)</label><input id="biz-renewal" type="date" value="${b.plan_renews_at ? b.plan_renews_at.slice(0, 10) : ''}"></div>
        <button class="btn block" data-act="save-renewal">Guardar vencimiento</button>

        <div class="two-col">
          <div class="field"><label for="courtesy-days">Días de cortesía</label><input id="courtesy-days" inputmode="numeric" placeholder="Ej. 15"></div>
          <div style="align-self:flex-end"><button class="btn block" data-act="add-courtesy">Agregar</button></div>
        </div>

        <div class="section-h"><h2>Usuarios (${S.members.length})</h2></div>
        <div class="list">${S.members.map((m) => `
          <div class="qrow" style="grid-template-columns:1fr auto">
            <span class="client">${esc(m.email)}</span>
            <span class="pill ${m.status === 'ACTIVE' ? 'done' : ''}" style="${m.status !== 'ACTIVE' ? 'background:var(--danger);color:#fff' : ''}">${m.status === 'ACTIVE' ? 'Activo' : 'Desactivado'}</span>
            <span class="meta">${m.role} · desde ${dateStr(m.created_at)}</span>
            <button class="btn ghost" data-act="toggle-member" data-id="${m.id}" data-v="${m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'}" style="grid-column:1/-1">${m.status === 'ACTIVE' ? 'Desactivar acceso' : 'Reactivar acceso'}</button>
          </div>`).join('') || '<div class="empty">Sin usuarios.</div>'}</div>
      </div>`;
  }

  function viewTickets() {
    return `
      <header class="top"><div class="brand">QuoteFlow<small>Admin</small></div></header>
      ${nav('tickets')}
      <div class="list" style="margin-top:14px">${S.tickets.map((t) => `
        <button class="qrow" data-act="open-ticket" data-id="${t.id}">
          <span class="client">${esc(t.subject)}</span>
          <span class="pill ${ticketDone(t) ? 'done' : 'draft'}">${TICKET_LABEL[t.status]}</span>
          <span class="meta">${esc((t.businesses && t.businesses.name) || '')} · ${t.priority} · ${dateStr(t.updated_at)}</span>
        </button>`).join('') || '<div class="empty">No hay tickets de soporte.</div>'}</div>`;
  }

  function viewTicket() {
    const t = S.ticket;
    return `
      <header class="top">
        <button class="icon-btn" data-act="nav" data-v="tickets" aria-label="Volver a soporte">${back}</button>
        <div class="title">${esc(t.subject)}</div>
        <span class="spacer"></span>
        <span class="pill ${ticketDone(t) ? 'done' : 'draft'}">${TICKET_LABEL[t.status]}</span>
      </header>
      <div class="stack">
        <p class="hint">${esc((t.businesses && t.businesses.name) || '')} · prioridad ${t.priority}</p>
        <button class="btn block ghost" data-act="support-access">Ver datos del negocio (queda registrado)</button>
        ${S.supportView ? `<div class="sheet"><b>${esc(S.supportView.business.name)}</b><br>${esc(S.supportView.business.email || '')} · ${S.supportView.business.status}<br><br>
          <b>Usuarios</b><br>${S.supportView.members.map((m) => `${esc(m.email)} (${m.role}, ${m.status})`).join('<br>')}<br><br>
          <b>Últimas cotizaciones</b><br>${S.supportView.recent_quotes.map((q) => `${esc(q.folio)} · ${esc(q.client_name)} · ${q.status}`).join('<br>') || 'Ninguna'}</div>` : ''}
        ${S.messages.map((m) => `
          <div class="card">
            <span class="tag ${m.author_role === 'admin' ? '' : 'warn'}">${m.author_role === 'admin' ? 'Tú (admin)' : 'Cliente'}</span>
            <div>${esc(m.body).replace(/\n/g, '<br>')}</div>
            <span class="hint" style="font-size:11px">${dateStr(m.created_at)}</span>
          </div>`).join('')}
        <form class="stack" id="reply-form">
          <textarea id="reply-body" placeholder="Responder al cliente" style="min-height:80px"></textarea>
          <button class="btn primary block" type="submit">Enviar respuesta</button>
        </form>
        <div class="seg" role="group">${['IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'].map((s) => `<button data-act="set-ticket-status" data-v="${s}" aria-pressed="${t.status === s}">${TICKET_LABEL[s]}</button>`).join('')}</div>
      </div>`;
  }

  function viewAudit() {
    return `
      <header class="top"><div class="brand">QuoteFlow<small>Admin</small></div></header>
      ${nav('audit')}
      <div class="sheet" style="margin-top:14px">${S.audit.map((a) => `
        <div style="padding-block:8px;border-top:1px solid var(--line)">
          <div class="row" style="justify-content:space-between"><b>${esc(a.action)}</b><span class="hint">${dateStr(a.created_at)}</span></div>
          <div class="hint">${esc(a.entity)} · ${esc(a.entity_id || '')}</div>
          ${a.after ? `<div class="hint mono" style="font-size:11px">${esc(JSON.stringify(a.after))}</div>` : ''}
        </div>`).join('') || '<span class="hint">Sin acciones registradas.</span>'}</div>`;
  }

  function render() {
    const views = {
      loading: viewLoading, auth: viewAuth, 'not-admin': viewNotAdmin,
      dashboard: viewDashboard, businesses: viewBusinesses, business: viewBusiness,
      tickets: viewTickets, ticket: viewTicket, audit: viewAudit,
    };
    app.innerHTML = views[S.view]();
  }

  /* ---------- carga de datos por sección ---------- */

  async function openDashboard() {
    try {
      S.stats = await QFA.dashboardStats();
      go('dashboard');
    } catch (e) {
      toast(e.message);
    }
  }

  async function openBusinesses() {
    try {
      S.businesses = await QFA.listBusinesses(S.search);
      go('businesses');
    } catch (e) {
      toast(e.message);
    }
  }

  async function openBusiness(id) {
    try {
      const list = S.businesses.length ? S.businesses : await QFA.listBusinesses('');
      const row = list.find((b) => b.id === id) || {};
      const [stats, members] = await Promise.all([QFA.businessStats(id), QFA.listMembers(id)]);
      S.business = Object.assign({ id }, row);
      S.businessStats = stats;
      S.members = members;
      go('business');
    } catch (e) {
      toast(e.message);
    }
  }

  async function refreshBusiness() {
    const id = S.business.id;
    const [stats, members] = await Promise.all([QFA.businessStats(id), QFA.listMembers(id)]);
    S.businessStats = stats;
    S.members = members;
    render();
  }

  async function openTickets() {
    try {
      S.tickets = await QFA.listTickets();
      go('tickets');
    } catch (e) {
      toast(e.message);
    }
  }

  async function openTicket(id) {
    try {
      S.ticket = S.tickets.find((t) => t.id === id);
      S.messages = await QFA.ticketMessages(id);
      S.supportView = null;
      go('ticket');
    } catch (e) {
      toast(e.message);
    }
  }

  async function openAudit() {
    try {
      S.audit = await QFA.auditLog(50);
      go('audit');
    } catch (e) {
      toast(e.message);
    }
  }

  const NAV = { dashboard: openDashboard, businesses: openBusinesses, tickets: openTickets, audit: openAudit };

  /* ---------- eventos ---------- */

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    switch (act) {
      case 'nav': return NAV[b.dataset.v]();
      case 'open-business': return openBusiness(b.dataset.id);
      case 'open-ticket': return openTicket(b.dataset.id);
      case 'logout': await CLOUD.auth.signOut(); S.session = null; return go('auth');
      case 'set-plan':
        try { S.business = Object.assign({}, S.business, await QFA.setBusinessPlan(S.business.id, b.dataset.v)); toast('Plan actualizado'); await refreshBusiness(); } catch (e) { toast(e.message); }
        return;
      case 'set-status':
        try { S.business = Object.assign({}, S.business, await QFA.setBusinessStatus(S.business.id, b.dataset.v)); toast('Estado actualizado'); await refreshBusiness(); } catch (e) { toast(e.message); }
        return;
      case 'save-renewal': {
        const v = document.getElementById('biz-renewal').value;
        if (!v) return toast('Elige una fecha.');
        try { S.business = Object.assign({}, S.business, await QFA.setBusinessRenewal(S.business.id, new Date(v + 'T23:59:59').toISOString())); toast('Vencimiento actualizado'); await refreshBusiness(); } catch (e) { toast(e.message); }
        return;
      }
      case 'add-courtesy': {
        const n = parseInt(document.getElementById('courtesy-days').value, 10);
        if (!n) return toast('Escribe un número de días.');
        try { S.business = Object.assign({}, S.business, await QFA.addCourtesyDays(S.business.id, n)); toast(n + ' día(s) agregados'); await refreshBusiness(); } catch (e) { toast(e.message); }
        return;
      }
      case 'toggle-member':
        try { await QFA.setMemberStatus(b.dataset.id, b.dataset.v); toast('Actualizado'); await refreshBusiness(); } catch (e) { toast(e.message); }
        return;
      case 'support-access':
        try { S.supportView = await QFA.supportAccess(S.ticket.id); render(); } catch (e) { toast(e.message); }
        return;
      case 'set-ticket-status':
        try { await QFA.setTicketStatus(S.ticket.id, b.dataset.v); S.ticket.status = b.dataset.v; render(); } catch (e) { toast(e.message); }
        return;
    }
  });

  app.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'auth-form') {
      const f = new FormData(e.target);
      S.authBusy = true;
      render();
      try {
        const { session } = await CLOUD.auth.signIn(String(f.get('email') || '').trim(), String(f.get('password') || ''));
        S.session = session;
        S.authBusy = false;
        await boot();
      } catch (err) {
        S.authBusy = false;
        toast(err.message);
        render();
      }
      return;
    }
    if (e.target.id === 'biz-search') return; // no usado (input, no form)
    if (e.target.id === 'reply-form') {
      const body = document.getElementById('reply-body').value.trim();
      if (!body) return;
      try {
        await QFA.replyTicket(S.ticket.id, S.session.user.id, body);
        return openTicket(S.ticket.id);
      } catch (err) {
        return toast(err.message);
      }
    }
  });

  app.addEventListener('change', (e) => {
    if (e.target.id === 'biz-search') {
      S.search = e.target.value;
      openBusinesses();
    }
  });

  async function boot() {
    S.view = 'loading';
    render();
    try {
      S.session = S.session || (await CLOUD.auth.getSession());
      if (!S.session) return go('auth');
      S.isAdmin = await QFA.isAdmin();
      if (!S.isAdmin) return go('not-admin');
      await openDashboard();
    } catch (e) {
      toast(e.message);
      go('auth');
    }
  }

  boot();
})();
