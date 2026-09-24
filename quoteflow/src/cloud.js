/* Capa de nube (Supabase) para QuoteFlow V0.3.
 * Todo lo que toca red vive aquí. storage.js (local) sigue siendo lo que la UI
 * lee y escribe siempre; este módulo mantiene ese caché local al día con la
 * nube cuando hay sesión y conexión, y nunca borra nada local por su cuenta.
 * El parser y los cálculos no pasan por aquí: solo datos ya estructurados. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const cfg = QF.config || { supabaseUrl: '', supabaseAnonKey: '' };

  function enabled() {
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  let _client = null;
  function client() {
    if (!enabled()) throw new Error('Supabase no está configurado.');
    if (!_client) {
      if (!root.supabase || !root.supabase.createClient) throw new Error('No se pudo cargar la librería de Supabase.');
      _client = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    }
    return _client;
  }

  // Mensaje entendible para el usuario a partir de un error de red/Supabase.
  function friendlyError(err) {
    const m = (err && (err.message || err.error_description)) || '';
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/already registered|already exists/i.test(m)) return 'Ya existe una cuenta con ese correo.';
    if (/password/i.test(m) && /least|short|6 characters/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
    if (/network|fetch/i.test(m)) return 'No hay conexión con el servidor. Intenta de nuevo.';
    return m || 'Ocurrió un error inesperado.';
  }

  /* ---------- sesión ---------- */
  const auth = {
    async signUp(email, password) {
      const { data, error } = await client().auth.signUp({ email, password });
      if (error) throw new Error(friendlyError(error));
      return data;
    },
    async signIn(email, password) {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw new Error(friendlyError(error));
      return data;
    },
    async signOut() {
      await client().auth.signOut();
    },
    async getSession() {
      const { data } = await client().auth.getSession();
      return data.session || null;
    },
    onChange(cb) {
      client().auth.onAuthStateChange((_event, session) => cb(session));
    },
  };

  /* ---------- negocio ---------- */
  const business = {
    // El primer negocio del que el usuario es miembro (V0.3 = un negocio por usuario).
    async getMine() {
      const { data, error } = await client().from('businesses').select('*').limit(1).maybeSingle();
      if (error) throw new Error(friendlyError(error));
      return data;
    },
    async create(fields) {
      const { data, error } = await client().rpc('create_business', {
        p_name: fields.name || '',
        p_rfc: fields.rfc || '',
        p_phone: fields.phone || '',
        p_email: fields.email || '',
        p_address: fields.address || '',
        p_currency: fields.currency || 'MXN',
        p_iva_rate_bp: fields.ivaRateBp || 1600,
        p_iva_mode: fields.ivaMode || 'mas',
        p_validity_days: fields.validityDays || 15,
        p_conditions: fields.conditions || '',
      });
      if (error) throw new Error(friendlyError(error));
      return data;
    },
    async saveSettings(businessId, settings) {
      const { error } = await client()
        .from('businesses')
        .update({
          name: settings.businessName || '',
          rfc: settings.rfc || '',
          phone: settings.phone || '',
          email: settings.email || '',
          address: settings.address || '',
          currency: settings.currency || 'MXN',
          iva_rate_bp: settings.ivaRateBp || 0,
          iva_mode: settings.ivaMode || 'mas',
          validity_days: settings.validityDays || 15,
          conditions: settings.conditions || '',
          updated_at: new Date().toISOString(),
        })
        .eq('id', businessId);
      if (error) throw new Error(friendlyError(error));
    },
  };

  function settingsFromBusinessRow(biz, currentLocal) {
    return Object.assign({}, currentLocal, {
      businessName: biz.name || '',
      rfc: biz.rfc || '',
      phone: biz.phone || '',
      email: biz.email || '',
      address: biz.address || '',
      currency: biz.currency || 'MXN',
      ivaRateBp: biz.iva_rate_bp,
      ivaMode: biz.iva_mode,
      validityDays: biz.validity_days,
      conditions: biz.conditions || '',
      // el logo se queda tal cual esté localmente: no viaja a la nube en V0.3
    });
  }

  /* ---------- catálogo (productos) ---------- */
  function productRow(businessId, entry) {
    return {
      business_id: businessId,
      key: entry.key,
      name: entry.name,
      unit: entry.unit || '',
      price_cents: entry.priceCents,
      uses: entry.uses || 1,
      updated_at: new Date(entry.updatedAt || Date.now()).toISOString(),
    };
  }
  function catalogFromRows(rows) {
    return rows.map((r) => ({ key: r.key, name: r.name, unit: r.unit, priceCents: r.price_cents, uses: r.uses, updatedAt: new Date(r.updated_at).getTime() }));
  }

  /* ---------- cotizaciones ---------- */
  function quoteRow(businessId, q) {
    const row = {
      business_id: businessId,
      folio: q.folio,
      client_name: q.client || '',
      status: q.status,
      discount_type: (q.discount && q.discount.type) || 'pct',
      discount_value: (q.discount && q.discount.value) || 0,
      iva_mode: q.ivaMode,
      iva_rate_bp: q.ivaRateBp,
      validity_days: q.validityDays,
      notes: q.notes || '',
      conditions: q.conditions || '',
      source_text: q.sourceText || '',
      updated_at: new Date(q.updatedAt || Date.now()).toISOString(),
      generated_at: q.generatedAt ? new Date(q.generatedAt).toISOString() : null,
    };
    if (looksLikeUuid(q.id)) row.id = q.id; // ya sincronizada antes: se actualiza el mismo renglón
    return row;
  }
  function looksLikeUuid(id) {
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
  }
  function quoteFromRow(row) {
    const items = (row.quote_items || [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((it) => ({
        id: it.id, desc: it.description, qtyMilli: it.qty_milli, unit: it.unit,
        priceCents: it.price_cents, priceSource: it.price_source, catalogName: it.catalog_name,
        flags: [], candidates: [],
      }));
    return {
      id: row.id, folio: row.folio, client: row.client_name, status: row.status,
      items, discount: { type: row.discount_type, value: row.discount_value },
      ivaMode: row.iva_mode, ivaRateBp: row.iva_rate_bp, validityDays: row.validity_days,
      notes: row.notes, conditions: row.conditions, sourceText: row.source_text,
      createdAt: new Date(row.created_at).getTime(), updatedAt: new Date(row.updated_at).getTime(),
      generatedAt: row.generated_at ? new Date(row.generated_at).getTime() : undefined,
    };
  }

  const data = {
    // Trae catálogo y cotizaciones del negocio y los mezcla en el caché local
    // (nunca borra local-only que aún no se haya subido).
    async pull(businessId) {
      const c = client();
      const [{ data: products, error: e1 }, { data: quotes, error: e2 }] = await Promise.all([
        c.from('products').select('*').eq('business_id', businessId),
        c.from('quotes').select('*, quote_items(*)').eq('business_id', businessId),
      ]);
      if (e1) throw new Error(friendlyError(e1));
      if (e2) throw new Error(friendlyError(e2));
      return { catalog: catalogFromRows(products || []), quotes: (quotes || []).map(quoteFromRow) };
    },

    // Sube o actualiza un producto del catálogo. Es "upsert": repetirlo no duplica.
    async pushProduct(businessId, entry) {
      const { error } = await client().from('products').upsert(productRow(businessId, entry), { onConflict: 'business_id,key' });
      if (error) throw new Error(friendlyError(error));
    },

    // Sube o actualiza una cotización completa. Devuelve el id definitivo
    // (si la cotización era solo local, cambia de id local a id de la nube).
    async pushQuote(businessId, q) {
      const { data: row, error } = await client().from('quotes').upsert(quoteRow(businessId, q)).select().single();
      if (error) throw new Error(friendlyError(error));
      const cloudId = row.id;
      const { error: delErr } = await client().from('quote_items').delete().eq('quote_id', cloudId);
      if (delErr) throw new Error(friendlyError(delErr));
      if (q.items.length) {
        const items = q.items.map((it, i) => ({
          quote_id: cloudId, sort_order: i, description: it.desc || '', qty_milli: it.qtyMilli,
          unit: it.unit || '', price_cents: it.priceCents, price_source: it.priceSource || null, catalog_name: it.catalogName || null,
        }));
        const { error: itemsErr } = await client().from('quote_items').insert(items);
        if (itemsErr) throw new Error(friendlyError(itemsErr));
      }
      return cloudId;
    },

    async deleteQuote(id) {
      if (!looksLikeUuid(id)) return; // nunca se subió, no hay nada que borrar en la nube
      const { error } = await client().from('quotes').delete().eq('id', id);
      if (error) throw new Error(friendlyError(error));
    },
  };

  QF.cloud = {
    enabled, client, auth, business, data, settingsFromBusinessRow, looksLikeUuid,
    // expuestos para pruebas de mapeo de datos (no dependen de red)
    _quoteRow: quoteRow, _quoteFromRow: quoteFromRow, _productRow: productRow, _catalogFromRows: catalogFromRows,
  };
  if (typeof module !== 'undefined') module.exports = QF.cloud;
})(typeof globalThis !== 'undefined' ? globalThis : this);
