/* Persistencia local (localStorage). Nada sale del dispositivo. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const K = { settings: 'qf.settings', quotes: 'qf.quotes', catalog: 'qf.catalog', folio: 'qf.folio', importDecided: 'qf.importDecided' };

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

    // Respaldo: un solo archivo con todo lo que vive en este dispositivo.
    exportBackup() {
      return {
        app: 'QuoteFlow',
        backupVersion: 1,
        exportedAt: Date.now(),
        settings: read(K.settings, {}),
        catalog: read(K.catalog, []),
        quotes: read(K.quotes, []),
        folio: read(K.folio, 0),
      };
    },

    // Valida la forma del archivo antes de tocar nada. No inventa ni completa
    // datos: si algo no tiene la forma esperada, se rechaza el respaldo completo.
    validateBackup(data) {
      if (!data || typeof data !== 'object') return 'El archivo no es un respaldo válido.';
      if (data.app !== 'QuoteFlow') return 'Este archivo no es un respaldo de QuoteFlow.';
      if (typeof data.backupVersion !== 'number') return 'El respaldo no indica su versión.';
      if (data.backupVersion > 1) return 'Este respaldo es de una versión más nueva de QuoteFlow.';
      if (typeof data.settings !== 'object' || data.settings === null) return 'Faltan los datos de configuración.';
      if (!Array.isArray(data.catalog)) return 'Faltan los datos del catálogo.';
      if (!Array.isArray(data.quotes)) return 'Faltan las cotizaciones.';
      for (const q of data.quotes) {
        if (!q || typeof q.id !== 'string' || !Array.isArray(q.items)) return 'Una cotización del respaldo está incompleta.';
      }
      return null;
    },

    // Reemplaza todo lo guardado por lo que trae el respaldo. Se usa junto con
    // validateBackup(): solo se llama si el archivo ya pasó la validación.
    restoreBackup(data) {
      write(K.settings, Object.assign({}, DEFAULT_SETTINGS, data.settings));
      write(K.catalog, data.catalog);
      write(K.quotes, data.quotes);
      if (typeof data.folio === 'number') write(K.folio, data.folio);
      return true;
    },

    // V0.3: si ya se le preguntó al usuario qué hacer con datos locales previos
    // al conectar una cuenta en la nube, para no volver a preguntarle cada vez.
    isImportDecided: () => !!read(K.importDecided, false),
    setImportDecided: () => write(K.importDecided, true),
  };

  QF.storage = storage;
  QF.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
