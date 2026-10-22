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

  // El reconocedor nativo de Android, a diferencia del de Chrome, entrega
  // VARIAS alternativas de lo que entendió (maxResults), no solo una. Antes
  // se usaba siempre la primera a secas; ahora se prefiere la alternativa
  // que más se parece a productos que este negocio ya tiene guardados en su
  // catálogo (misma lógica de catalog.js), o la que trae números si ninguna
  // coincide con el catálogo — un precio o cantidad mal oído es el error más
  // caro, así que se le da prioridad sobre el resto del texto.
  function pickBestMatch(matches) {
    if (!matches || !matches.length) return '';
    if (matches.length === 1) return matches[0];
    const CAT = root.QF && root.QF.catalog;
    const tok = CAT ? CAT.tokens : (s) => String(s || '').toLowerCase().split(/\s+/).filter(Boolean);
    let vocab = new Set();
    try {
      const DB = root.QF && root.QF.storage;
      const catalog = (DB && DB.getCatalog && DB.getCatalog()) || [];
      catalog.forEach((p) => tok(p.name).forEach((t) => vocab.add(t)));
    } catch (e) { /* sin catálogo disponible todavía: se sigue sin ese extra */ }
    const score = (m) => {
      const toks = tok(m);
      let s = toks.filter((t) => vocab.has(t)).length * 2;
      if (/\d/.test(m)) s += 1;
      return s;
    };
    return matches.slice().sort((a, b) => score(b) - score(a))[0];
  }

  // Misma idea que startWeb, pero sobre el reconocimiento nativo de Android
  // (vía @capacitor-community/speech-recognition). Dos cosas de ese plugin
  // que no son obvias por su documentación, vistas directo en su código:
  //
  // 1. Cuando se usa start({ partialResults: true, ... }), la promesa de
  //    start() se resuelve de inmediato (sin texto) — TODO el texto, incluido
  //    el de cada frase ya terminada, llega por el evento "partialResults".
  //    El evento "listeningState" avisa "stopped" justo cuando deja de oír
  //    voz, pero ANTES de entregar el texto final de esa frase; si se
  //    reinicia ahí mismo, se cancela la sesión justo antes de que alcance a
  //    mandar ese texto. Por eso aquí no se usa ese evento para reiniciar:
  //    se vigila con isListening() cada cierto tiempo y se deja un respiro
  //    antes de reiniciar, para darle tiempo a entregar lo último que oyó.
  // 2. stop() del lado nativo nunca avisa que terminó (no resuelve ni
  //    rechaza su promesa) — si algo se queda esperando esa respuesta, se
  //    queda esperando para siempre. Por eso "Listo"/"Cancelar" no esperan
  //    esa respuesta: piden detener y de una vez siguen con lo que ya se
  //    tiene, sin bloquearse.
  function startNative(cb) {
    let finalText = '';
    let stopped = false;
    let failed = false;
    let starting = false;
    let partialHandle = null;
    let pollTimer = null;

    async function ensurePermission() {
      const status = await NativeSR.checkPermissions();
      if (status.speechRecognition === 'granted') return;
      const req = await NativeSR.requestPermissions();
      if (req.speechRecognition !== 'granted') throw new Error('not-allowed');
    }

    function beginListening() {
      if (stopped || starting) return;
      starting = true;
      NativeSR.start({ language: 'es-MX', maxResults: 5, partialResults: true, popup: false })
        .catch(() => { /* errores de permiso ya se resolvieron antes de llegar aquí */ })
        .finally(() => { starting = false; });
    }

    function schedulePoll() {
      pollTimer = setTimeout(async () => {
        if (stopped) return;
        try {
          const { listening } = await NativeSR.isListening();
          if (!listening && !starting) {
            // Respiro antes de reiniciar: le da tiempo al texto final de la
            // frase que se acaba de terminar a llegar por "partialResults"
            // antes de cancelar esa sesión para empezar la siguiente.
            await new Promise((r) => setTimeout(r, 400));
            if (!stopped) beginListening();
          }
        } catch (e) { /* se reintenta en el siguiente ciclo */ }
        schedulePoll();
      }, 700);
    }

    (async () => {
      try {
        await ensurePermission();
        partialHandle = await NativeSR.addListener('partialResults', (data) => {
          const t = pickBestMatch(data && data.matches);
          if (t) { finalText = t; cb.onText && cb.onText(t); }
        });
        beginListening();
        schedulePoll();
      } catch (e) {
        failed = true;
        cb.onError && cb.onError(e && e.message === 'not-allowed' ? 'not-allowed' : 'native-error');
      }
    })();

    function finish() {
      if (pollTimer) clearTimeout(pollTimer);
      if (partialHandle) partialHandle.remove().catch(() => {});
      if (!failed) cb.onEnd && cb.onEnd(finalText.trim());
    }

    return {
      // No se espera la respuesta de NativeSR.stop(): ese método nunca la
      // manda (ver nota arriba), esperarla dejaría "Listo"/"Cancelar" sin
      // reaccionar nunca.
      stop: () => { stopped = true; try { NativeSR.stop(); } catch (e) { /* no crítico: ya se va a dejar de escuchar de todos modos */ } finish(); },
      abort: () => { stopped = true; failed = true; try { NativeSR.stop(); } catch (e) { /* idem */ } finish(); },
    };
  }

  function start(cb) {
    return isNative ? startNative(cb) : startWeb(cb);
  }

  QF.voice = { supported, start, clean };
})(typeof globalThis !== 'undefined' ? globalThis : this);
