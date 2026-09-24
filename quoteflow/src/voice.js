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
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += (finalText ? ' ' : '') + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      cb.onText && cb.onText((finalText + ' ' + interim).trim());
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
