/* Persistencia local (localStorage). Nada sale del dispositivo. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const K = { settings: 'qf.settings', quotes: 'qf.quotes', catalog: 'qf.catalog', folio: 'qf.folio' };

  const DEFAULT_SETTINGS = {
    businessName: '', logo: '', phone: '', email: '', rfc: '', address: '',
    currency: 'MXN', ivaRateBp: 1600, ivaMode: 'mas', validityDays: 15,
    conditions: 'Precios sujetos a cambio sin previo aviso después de la vigencia.\nTiempo de entrega a convenir.',
  };

  function read(key, fallback) {
    try {
      const v = root.localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      root.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  const storage = {
    getSettings: () => Object.assign({}, DEFAULT_SETTINGS, read(K.settings, {})),
    saveSettings: (s) => write(K.settings, s),
    getCatalog: () => read(K.catalog, []),
    saveCatalog: (c) => write(K.catalog, c),
    getQuotes: () => read(K.quotes, []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    getQuote: (id) => read(K.quotes, []).find((q) => q.id === id) || null,
    saveQuote(q) {
      const all = read(K.quotes, []);
      const i = all.findIndex((x) => x.id === q.id);
      if (i >= 0) all[i] = q;
      else all.push(q);
      return write(K.quotes, all);
    },
    deleteQuote(id) {
      return write(K.quotes, read(K.quotes, []).filter((q) => q.id !== id));
    },
    nextFolio() {
      const n = (read(K.folio, 0) || 0) + 1;
      write(K.folio, n);
      return 'COT-' + String(n).padStart(4, '0');
    },
  };

  QF.storage = storage;
  QF.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
