/* Compartir: hoja nativa del dispositivo (Web Share API con archivos).
 * Si no existe, descarga el PDF. No hay integración directa con WhatsApp. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function canShareFiles() {
    try {
      const f = new File(['x'], 'x.pdf', { type: 'application/pdf' });
      return !!(navigator.canShare && navigator.canShare({ files: [f] }));
    } catch (e) {
      return false;
    }
  }

  // Devuelve 'shared' | 'cancelled' | 'downloaded'
  async function sharePdf(blob, filename, title, text) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title, text });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
      }
    }
    download(blob, filename);
    return 'downloaded';
  }

  QF.share = { sharePdf, download, canShareFiles };
})(typeof globalThis !== 'undefined' ? globalThis : this);
