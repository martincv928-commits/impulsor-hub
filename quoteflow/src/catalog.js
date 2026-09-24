/* Catálogo/memoria local de productos y servicios usados.
 * Funciones puras sobre un arreglo de entradas; la persistencia vive en storage.js. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'y', 'en', 'un', 'una']);

  function tokens(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !STOP.has(t))
      .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
  }

  function key(name) {
    return tokens(name).join(' ');
  }

  function isSubset(a, b) {
    return a.length > 0 && a.every((t) => b.includes(t));
  }

  /* Devuelve { match, candidates, exact }.
   * match: entrada única encontrada; candidates: >1 posibles (ambigüedad). */
  function find(entries, name) {
    const q = tokens(name);
    if (!q.length) return { match: null, candidates: [], exact: false };
    const k = q.join(' ');
    const exact = entries.find((e) => e.key === k);
    if (exact) return { match: exact, candidates: [], exact: true };
    const cands = entries
      .filter((e) => {
        const et = e.key.split(' ');
        return isSubset(q, et) || isSubset(et, q);
      })
      .sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    if (cands.length === 1) return { match: cands[0], candidates: [], exact: false };
    return { match: null, candidates: cands.slice(0, 5), exact: false };
  }

  // Guarda/actualiza con el último precio usado. Devuelve un arreglo nuevo.
  function upsert(entries, item, now) {
    const k = key(item.desc);
    if (!k || item.priceCents === null || item.priceCents === undefined) return entries;
    const out = entries.slice();
    const i = out.findIndex((e) => e.key === k);
    const prev = i >= 0 ? out[i] : { uses: 0 };
    const entry = {
      key: k,
      name: item.desc.trim(),
      unit: item.unit || prev.unit || '',
      priceCents: item.priceCents,
      uses: (prev.uses || 0) + 1,
      updatedAt: now || Date.now(),
    };
    if (i >= 0) out[i] = entry;
    else out.push(entry);
    return out;
  }

  QF.catalog = { tokens, key, find, upsert };
  if (typeof module !== 'undefined') module.exports = QF.catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
