/* Generador de PDF (jsPDF, en el dispositivo). Usa los totales calculados por money.js. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});

  const INK = [22, 33, 28];
  const MUTED = [94, 107, 100];
  const LINE = [214, 221, 216];
  const ACCENT = [39, 67, 184];
  const SOFT = [240, 243, 250];

  function fmtDate(ts) {
    const d = new Date(ts);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }

  function imgFormat(dataUrl) {
    return /^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG';
  }

  function build(quote, settings) {
    const M = QF.money;
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const L = 16;
    const R = W - 16;
    const cur = settings.currency || 'MXN';
    const money = (c) => M.format(c, null);
    let y = 16;

    // Encabezado
    let textX = L;
    if (settings.logo) {
      try {
        const p = doc.getImageProperties(settings.logo);
        const maxW = 32, maxH = 22;
        const k = Math.min(maxW / p.width, maxH / p.height);
        doc.addImage(settings.logo, imgFormat(settings.logo), L, y, p.width * k, p.height * k);
        textX = L + p.width * k + 5;
      } catch (e) { /* logo inválido: se omite */ }
    }
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(settings.businessName || 'Mi negocio', textX, y + 5, { maxWidth: 105 - (textX - L) });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    const contact = [settings.address, settings.phone && 'Tel. ' + settings.phone, settings.email, settings.rfc && 'RFC: ' + settings.rfc].filter(Boolean);
    contact.forEach((c, i) => doc.text(String(c), textX, y + 10 + i * 4, { maxWidth: 105 - (textX - L) }));

    doc.setTextColor(...ACCENT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('COTIZACIÓN', R, y + 5, { align: 'right' });
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const issued = quote.generatedAt || quote.updatedAt || Date.now();
    const until = issued + (quote.validityDays || 0) * 86400000;
    const meta = [['Folio', quote.folio || '—'], ['Fecha', fmtDate(issued)], ['Válida hasta', fmtDate(until)]];
    meta.forEach(([k, v], i) => {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(k, R - 32, y + 11 + i * 4.6, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...INK);
      doc.text(String(v), R, y + 11 + i * 4.6, { align: 'right' });
    });

    y = Math.max(y + 12 + contact.length * 4, y + 26) + 4;
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.6);
    doc.line(L, y, R, y);
    y += 7;

    // Cliente
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('CLIENTE', L, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(quote.client || '—', L, y + 5.5, { maxWidth: R - L });
    y += 13;

    // Tabla
    const cols = [
      { key: 'qty', title: 'Cant.', w: 18, align: 'right' },
      { key: 'unit', title: 'Unidad', w: 22, align: 'left' },
      { key: 'desc', title: 'Concepto', w: 0, align: 'left' },
      { key: 'price', title: 'P. unitario', w: 28, align: 'right' },
      { key: 'amount', title: 'Importe', w: 30, align: 'right' },
    ];
    const fixed = cols.reduce((s, c) => s + c.w, 0);
    cols[2].w = R - L - fixed;
    let x = L;
    cols.forEach((c) => { c.x = x; x += c.w; });

    function header() {
      doc.setFillColor(...SOFT);
      doc.rect(L, y - 4.5, R - L, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...ACCENT);
      cols.forEach((c) => doc.text(c.title, c.align === 'right' ? c.x + c.w - 2 : c.x + 2, y, { align: c.align }));
      y += 6;
    }
    header();
    doc.setFontSize(9.5);
    for (const it of quote.items) {
      const descLines = doc.splitTextToSize(it.desc || '', cols[2].w - 4);
      const rowH = Math.max(1, descLines.length) * 4.4 + 2.6;
      if (y + rowH > H - 60) {
        doc.addPage();
        y = 20;
        header();
        doc.setFontSize(9.5);
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...INK);
      const vals = {
        qty: M.milliToStr(it.qtyMilli),
        unit: it.unit || '',
        price: money(it.priceCents),
        amount: money(M.lineAmount(it)),
      };
      cols.forEach((c) => {
        if (c.key === 'desc') doc.text(descLines, c.x + 2, y);
        else doc.text(String(vals[c.key]), c.align === 'right' ? c.x + c.w - 2 : c.x + 2, y, { align: c.align });
      });
      y += rowH;
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.2);
      doc.line(L, y - 3.6, R, y - 3.6);
    }

    // Totales
    const t = M.computeTotals(quote);
    const rate = (quote.ivaRateBp / 100).toString().replace(/\.0+$/, '');
    const rows = [['Subtotal', money(t.subtotal)]];
    if (t.discount > 0) {
      const dLabel = quote.discount.type === 'pct' ? 'Descuento ' + (quote.discount.value / 100) + '%' : 'Descuento';
      rows.push([dLabel, '-' + money(t.discount)]);
    }
    if (quote.ivaMode === 'mas') {
      if (t.discount > 0) rows.push(['Base', money(t.base)]);
      rows.push(['IVA ' + rate + '%', money(t.iva)]);
    } else if (quote.ivaMode === 'incluido') {
      rows.push(['Importe sin IVA', money(t.net)]);
      rows.push(['IVA ' + rate + '% (incluido)', money(t.iva)]);
    }
    if (y + rows.length * 5.5 + 14 > H - 20) { doc.addPage(); y = 20; }
    y += 3;
    const lx = R - 72;
    doc.setFontSize(9.5);
    rows.forEach(([k, v]) => {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(k, lx, y);
      doc.setTextColor(...INK);
      doc.text(v, R - 2, y, { align: 'right' });
      y += 5.5;
    });
    doc.setFillColor(...ACCENT);
    doc.rect(lx - 3, y - 4, R - lx + 3, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text('TOTAL ' + cur, lx, y + 2);
    doc.text(money(t.total), R - 2, y + 2, { align: 'right' });
    if (quote.ivaMode === 'sin') {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text('Precios sin IVA', R - 2, y + 9, { align: 'right' });
    }
    y += 16;

    // Vigencia, notas, condiciones
    function block(title, body) {
      if (!body) return;
      const lines = doc.splitTextToSize(String(body), R - L);
      if (y + lines.length * 4.2 + 8 > H - 16) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(title.toUpperCase(), L, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(lines, L, y + 4.6);
      y += lines.length * 4.2 + 9;
    }
    block('Vigencia', `Esta cotización es válida por ${quote.validityDays} días, hasta el ${fmtDate(until)}.`);
    block('Notas', quote.notes);
    block('Condiciones', quote.conditions);

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(`${quote.folio || ''} · Precios en ${cur}`, L, H - 9);
      doc.text(`Página ${i} de ${pages}`, R, H - 9, { align: 'right' });
    }
    return doc;
  }

  function filename(quote) {
    const c = (quote.client || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return `Cotizacion_${quote.folio || 'borrador'}_${c}.pdf`;
  }

  QF.pdf = {
    blob: (quote, settings) => build(quote, settings).output('blob'),
    filename,
    fmtDate,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
