/* Compartir, ver y descargar archivos (PDF, CSV, respaldo).
 * En el sitio web usa las APIs del navegador (Web Share, enlaces de
 * descarga, abrir en pestaña nueva). Esas APIs no existen dentro de un
 * WebView nativo (solo las tiene Chrome completo), así que ahí se usan en
 * su lugar los plugins nativos de Capacitor: escribir el archivo en el
 * dispositivo y abrirlo/compartirlo con el selector nativo de Android. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const isNative = !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
  const Plugins = isNative && root.Capacitor.Plugins;

  function downloadWeb(blob, filename) {
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
    if (isNative) return !!(Plugins.Share && Plugins.Filesystem);
    try {
      const f = new File(['x'], 'x.pdf', { type: 'application/pdf' });
      return !!(navigator.canShare && navigator.canShare({ files: [f] }));
    } catch (e) {
      return false;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Escribe el archivo en la caché propia de la app (la única carpeta que
  // Capacitor deja compartir/abrir sin pedir permisos extra de
  // almacenamiento) y devuelve su ruta en el dispositivo.
  async function writeNativeFile(blob, filename) {
    const { Filesystem } = Plugins;
    const data = await blobToBase64(blob);
    await Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
    const { uri } = await Filesystem.getUri({ path: filename, directory: 'CACHE' });
    return uri;
  }

  // Devuelve 'shared' | 'cancelled' | 'downloaded'
  async function sharePdf(blob, filename, title, text) {
    if (isNative) {
      try {
        const uri = await writeNativeFile(blob, filename);
        await Plugins.Share.share({ title, text, url: uri, dialogTitle: title });
        return 'shared';
      } catch (e) {
        if (e && /cancel/i.test(String(e.message))) return 'cancelled';
        return 'downloaded'; // se intenta igual guardarlo, ver download()
      }
    }
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title, text });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
      }
    }
    downloadWeb(blob, filename);
    return 'downloaded';
  }

  // Dentro de la app nativa no existe una carpeta de "Descargas" del
  // navegador a la que escribir directo; en su lugar se abre el mismo
  // selector nativo de compartir, que entre sus opciones ya incluye
  // "Guardar en archivos"/Drive/etc. — así sigue quedando en manos de la
  // persona dónde guardarlo, sin pedir permisos de almacenamiento de más.
  async function download(blob, filename) {
    if (isNative) {
      try {
        const uri = await writeNativeFile(blob, filename);
        await Plugins.Share.share({ title: filename, url: uri, dialogTitle: 'Guardar ' + filename });
      } catch (e) { /* la persona cerró el selector: no es un error real */ }
      return;
    }
    downloadWeb(blob, filename);
  }

  // Abre el PDF con el visor que ya tenga instalado el dispositivo
  // (equivalente nativo de abrir el blob en una pestaña nueva del navegador).
  async function viewPdf(blob, filename) {
    if (isNative) {
      try {
        const uri = await writeNativeFile(blob, filename);
        await Plugins.FileOpener.open({ filePath: uri, contentType: 'application/pdf', openWithDefault: true });
      } catch (e) {
        toastFallback('No se pudo abrir el PDF. Usa "Descargar" o "Compartir" en su lugar.');
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    if (!window.open(url, '_blank')) location.href = url;
  }

  // share.js no tiene acceso al toast() de app.js; esto solo se usa si
  // viewPdf falla dentro de la app nativa, como último aviso visible.
  function toastFallback(msg) {
    try { if (typeof alert === 'function') alert(msg); } catch (e) { /* nada más que hacer */ }
  }

  QF.share = { sharePdf, download, viewPdf, canShareFiles };
})(typeof globalThis !== 'undefined' ? globalThis : this);
