/* Voz: reconocimiento del propio dispositivo/navegador (Web Speech API).
 * Solo produce texto; el texto pasa por el mismo intérprete que la entrada escrita. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;

  const words = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9$ñ.]+/g, ' ').trim().split(/\s+/).filter(Boolean);

  /* Chrome en Android entrega resultados acumulados y a veces revisados:
   * "hazme" · "hazme una" · "hazme una cotización para …" (a veces la última versión pierde palabras).
   * Se parte el texto donde reaparece su primera palabra; si cada pedazo es el inicio del pedazo
   * más largo, son versiones de la misma frase y se conserva la más larga.
   * Si no se cumple (texto normal), se devuelve sin cambios. */
  function clean(text) {
    const toks = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (toks.length < 3) return toks.join(' ');
    const norm = toks.map((t) => words(t).join(' '));
    const chunks = [];
    toks.forEach((t, i) => {
      if (i === 0 || norm[i] === norm[0]) chunks.push([]);
      chunks[chunks.length - 1].push(i);
    });
    if (chunks.length < 2) return toks.join(' ');
    // El dictado puede corregir una palabra a medio camino (p. ej. "litros" -> "L"),
    // así que una repetición cuenta como "versión anterior de la misma frase" si
    // coincide con la versión más larga en casi todas sus palabras (como máximo
    // una distinta). Si dos repeticiones se parecen menos que eso, es texto
    // normal que casualmente repite su primera palabra, y no se toca nada.
    const longest = chunks.reduce((a, c) => (c.length >= a.length ? c : a), []);
    const isVersion = (c) => {
      if (c.length > longest.length) return false;
      const mismatches = c.reduce((n, ti, j) => n + (norm[ti] === norm[longest[j]] ? 0 : 1), 0);
      return mismatches <= 1;
    };
    if (!chunks.every(isVersion)) return toks.join(' ');
    return longest.map((i) => toks[i]).join(' ');
  }

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
    function merge(results, onlyFinal) {
      const parts = [];
      for (let i = 0; i < results.length; i++) {
        if (onlyFinal && !results[i].isFinal) continue;
        const t = results[i][0].transcript.trim();
        if (t) parts.push(t);
      }
      return clean(parts.join(' '));
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

  QF.voice = { supported, start, clean };
})(typeof globalThis !== 'undefined' ? globalThis : this);
