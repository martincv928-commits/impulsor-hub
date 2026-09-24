/* Voz: reconocimiento del propio dispositivo/navegador (Web Speech API).
 * Solo produce texto; el texto pasa por el mismo intérprete que la entrada escrita. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;

  function supported() {
    return !!SR;
  }

  // Devuelve { stop() }. Callbacks: onText(texto, esFinal), onEnd(textoFinal), onError(codigo)
  function start(cb) {
    const rec = new SR();
    rec.lang = 'es-MX';
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '';
    let failed = false;
    // Chrome en Android entrega resultados acumulados ("puedes", "puedes cotizarme", ...):
    // se reconstruye el texto con todos los resultados y se descartan los prefijos repetidos.
    function merge(results, onlyFinal) {
      const parts = [];
      for (let i = 0; i < results.length; i++) {
        if (onlyFinal && !results[i].isFinal) continue;
        const t = results[i][0].transcript.trim();
        if (!t) continue;
        const last = parts[parts.length - 1];
        const a = t.toLowerCase();
        const b = last ? last.toLowerCase() : '';
        if (last && a.startsWith(b)) parts[parts.length - 1] = t;
        else if (last && b.startsWith(a)) continue;
        else parts.push(t);
      }
      return parts.join(' ');
    }
    rec.onresult = (ev) => {
      finalText = merge(ev.results, true);
      cb.onText && cb.onText(merge(ev.results, false));
    };
    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      failed = true;
      cb.onError && cb.onError(ev.error);
    };
    rec.onend = () => {
      if (!failed) cb.onEnd && cb.onEnd(finalText.trim());
    };
    rec.start();
    return { stop: () => rec.stop(), abort: () => { failed = true; rec.abort(); } };
  }

  QF.voice = { supported, start };
})(typeof globalThis !== 'undefined' ? globalThis : this);
