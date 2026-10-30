/* Solo dentro del APK: conecta el botón "atrás" del celular y abre archivos
 * adjuntos con el navegador del sistema (window.open no existe en un WebView). */
(function () {
  var C = window.Capacitor;
  if (!(C && C.isNativePlatform && C.isNativePlatform())) return;
  var App = C.Plugins.App, Browser = C.Plugins.Browser;
  window.open = function (url) {
    try { if (Browser) Browser.open({ url: url }); else location.href = url; } catch (e) { /* sin navegador */ }
    return {};
  };
  if (App) App.addListener('backButton', function () {
    var btn = document.querySelector('header.top .icon-btn[aria-label^="Volver"]');
    if (btn) btn.click(); else App.exitApp();
  });
})();
