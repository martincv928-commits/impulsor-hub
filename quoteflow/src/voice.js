/* Voz: reconocimiento del propio dispositivo/navegador.
 * En el sitio web (navegador) usa la Web Speech API de Chrome, como siempre.
 * Dentro de la app nativa de Play Store no existe esa API (solo la tiene
 * Chrome completo, no un WebView), así que ahí se usa en su lugar el
 * reconocimiento nativo de Android vía un plugin de Capacitor. Ambos caminos
 * terminan entregando el mismo texto al mismo intérprete de siempre. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  const isNative = !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
  const NativeSR = isNative && root.Capacitor.Plugins && root.Capacitor.Plugins.SpeechRecognition;

  const words = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$ñ.]+/g, ' ').trim().split(/\s+/).filter(Boolean);

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
    return isNative ? !!NativeSR : !!SR;
  }

  // Devuelve { stop() }. Callbacks: onText(texto, esFinal), onEnd(textoFinal), onError(codigo)
  //
  // El navegador deja de escuchar solo tras unos segundos de silencio (error
  // "no-speech"), incluso si el usuario no alcanzó a empezar a hablar
  // todavía — eso se sentía como que el micrófono "se cerraba muy rápido".
  // Mientras el usuario no cancele ni toque "Listo", ese silencio no cierra
  // el dictado: se reinicia solo el reconocimiento por dentro y se sigue
  // escuchando, sin que se note nada en la pantalla.
  function startWeb(cb) {
    let rec;
    let finalText = '';
    let failed = false;
    let stopped = false;
    let restarting = false;

    function merge(results, onlyFinal) {
      const parts = [];
      for (let i = 0; i < results.length; i++) {
        if (onlyFinal && !results[i].isFinal) continue;
        const t = results[i][0].transcript.trim();
        if (t) parts.push(t);
      }
      return clean(parts.join(' '));
    }

    function makeRecognizer() {
      const r = new SR();
      r.lang = 'es-MX';
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (ev) => {
        finalText = merge(ev.results, true);
        cb.onText && cb.onText(merge(ev.results, false));
      };
      r.onerror = (ev) => {
        if (ev.error === 'no-speech' && !stopped) { restarting = true; return; }
        if (ev.error === 'aborted') return;
        failed = true;
        cb.onError && cb.onError(ev.error);
      };
      r.onend = () => {
        if (restarting) {
          restarting = false;
          rec = makeRecognizer();
          try { rec.start(); } catch (e) { /* se reinició demasiado rápido: se ignora, ya quedó escuchando */ }
          return;
        }
        if (!failed) cb.onEnd && cb.onEnd(finalText.trim());
      };
      return r;
    }

    rec = makeRecognizer();
    rec.start();
    return {
      stop: () => { stopped = true; rec.stop(); },
      abort: () => { stopped = true; failed = true; rec.abort(); },
    };
  }

  // Misma idea que startWeb, pero sobre el reconocimiento nativo de Android
  // (vía @capacitor-community/speech-recognition), que solo escucha una
  // frase a la vez y se detiene con el silencio: se reinicia solo mientras
  // no se pida detener, para que se sienta igual de continuo que en la web.
  function startNative(cb) {
    let finalText = '';
    let stopped = false;
    let failed = false;
    let listenerHandle = null;

    async function ensurePermission() {
      const status = await NativeSR.checkPermissions();
      if (status.speechRecognition === 'granted') return;
      const req = await NativeSR.requestPermissions();
      if (req.speechRecognition !== 'granted') throw new Error('not-allowed');
    }

    async function listenOnce() {
      const result = await NativeSR.start({ language: 'es-MX', partialResults: true, popup: false, maxResults: 1 });
      return (result && result.matches && result.matches[0]) || '';
    }

    (async () => {
      try {
        await ensurePermission();
        listenerHandle = await NativeSR.addListener('partialResults', (data) => {
          const t = (data && data.matches && data.matches[0]) || '';
          if (t) { finalText = t; cb.onText && cb.onText(t); }
        });
        while (!stopped) {
          try {
            const text = await listenOnce();
            if (text) finalText = text;
          } catch (e) {
            if (stopped) break;
            // silencio o sin coincidencia en esta pasada: se reintenta solo,
            // igual que el manejo de "no-speech" en la versión web.
          }
        }
      } catch (e) {
        if (!stopped) { failed = true; cb.onError && cb.onError(e && e.message === 'not-allowed' ? 'not-allowed' : 'native-error'); }
      }
      if (listenerHandle) listenerHandle.remove();
      if (!failed) cb.onEnd && cb.onEnd(finalText.trim());
    })();

    return {
      stop: () => { stopped = true; NativeSR.stop().catch(() => {}); },
      abort: () => { stopped = true; failed = true; NativeSR.stop().catch(() => {}); },
    };
  }

  function start(cb) {
    return isNative ? startNative(cb) : startWeb(cb);
  }

  QF.voice = { supported, start, clean };
})(typeof globalThis !== 'undefined' ? globalThis : this);
