/* Motor de cálculos determinístico.
 * Dinero en centavos (enteros). Cantidades en milésimas (enteros).
 * Porcentajes en puntos base (1600 = 16%). Nunca se usan floats para importes. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});

  // Redondeo half-up de a/b para enteros (b > 0).
  function divRound(a, b) {
    const sign = a < 0 ? -1 : 1;
    const n = Math.abs(a);
    return sign * Math.floor((n * 2 + b) / (b * 2));
  }

  // "1,850.50" | "12.5" | 14 -> centavos. Devuelve null si no es número.
  function toCents(v) {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).replace(/[$\s,]/g, '');
    const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[2] === '' && !m[3])) return null;
    const frac = ((m[3] || '') + '000').slice(0, 3);
    let cents = parseInt(m[2] || '0', 10) * 100 + parseInt(frac.slice(0, 2), 10);
    if (parseInt(frac[2], 10) >= 5) cents += 1;
    return m[1] ? -cents : cents;
  }

  // "2.5" -> 2500 milésimas.
  function toMilli(v) {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).replace(/[\s,]/g, '');
    const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[1] === '' && !m[2])) return null;
    const frac = ((m[2] || '') + '0000').slice(0, 4);
    let milli = parseInt(m[1] || '0', 10) * 1000 + parseInt(frac.slice(0, 3), 10);
    if (parseInt(frac[3], 10) >= 5) milli += 1;
    return milli;
  }

  // "16" | "5.5" -> puntos base.
  function toBp(v) {
    const c = toCents(v);
    return c === null ? null : c;
  }

  function milliToStr(m) {
    if (m === null || m === undefined) return '';
    const int = Math.floor(m / 1000);
    const frac = String(m % 1000).padStart(3, '0').replace(/0+$/, '');
    return frac ? int + '.' + frac : String(int);
  }

  function centsToStr(c) {
    if (c === null || c === undefined) return '';
    const neg = c < 0;
    const n = Math.abs(c);
    return (neg ? '-' : '') + Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
  }

  function format(c, currency) {
    if (c === null || c === undefined) return '—';
    const neg = c < 0;
    const n = Math.abs(c);
    const int = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '$' + int + '.' + String(n % 100).padStart(2, '0') + (currency && currency !== 'MXN' ? ' ' + currency : '');
  }

  function lineAmount(line) {
    if (line.qtyMilli === null || line.qtyMilli === undefined) return null;
    if (line.priceCents === null || line.priceCents === undefined) return null;
    return divRound(line.qtyMilli * line.priceCents, 1000);
  }

  /* quote: { items[], discount: {type:'pct'|'amount', value(bp|cents)}, ivaMode: 'mas'|'sin'|'incluido', ivaRateBp }
   * ivaMode 'incluido': los precios ya incluyen IVA; se desglosa. */
  function computeTotals(quote) {
    let subtotal = 0;
    let incomplete = 0;
    for (const it of quote.items) {
      const a = lineAmount(it);
      if (a === null) incomplete++;
      else subtotal += a;
    }
    const d = quote.discount || { type: 'pct', value: 0 };
    let discount = 0;
    if (d.type === 'amount') discount = Math.min(d.value || 0, subtotal);
    else discount = divRound(subtotal * (d.value || 0), 10000);
    const base = subtotal - discount;
    const rate = quote.ivaRateBp || 0;
    let iva = 0;
    let total = base;
    let net = base;
    if (quote.ivaMode === 'mas') {
      iva = divRound(base * rate, 10000);
      total = base + iva;
    } else if (quote.ivaMode === 'incluido') {
      net = divRound(base * 10000, 10000 + rate);
      iva = base - net;
      total = base;
    }
    return { subtotal, discount, base, net, iva, total, incomplete };
  }

  QF.money = { divRound, toCents, toMilli, toBp, milliToStr, centsToStr, format, lineAmount, computeTotals };
  if (typeof module !== 'undefined') module.exports = QF.money;
})(typeof globalThis !== 'undefined' ? globalThis : this);
