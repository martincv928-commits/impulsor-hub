/* Parser local de frases de cotización (español mexicano).
 * Solo reglas/regex + catálogo local. Nunca calcula importes: eso es money.js. */
(function (root) {
  'use strict';
  const QF = (root.QF = root.QF || {});
  const M = QF.money || (typeof require !== 'undefined' ? require('./money.js') : null);
  const C = QF.catalog || (typeof require !== 'undefined' ? require('./catalog.js') : null);

  const NUM_WORDS = {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30,
    cuarenta: 40, cincuenta: 50, cien: 100, ciento: 100, doscientos: 200, quinientos: 500, mil: 1000,
  };
  const NW = Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join('|');

  // [regex, unidad canónica] — más largos primero.
  const UNITS = [
    [/^metros?\s+cuadrados?$|^m2$|^m²$/, 'm²'],
    [/^metros?\s+c[uú]bicos?$|^m3$|^m³$/, 'm³'],
    [/^litros?$|^lts?\.?$|^l$/, 'litro'],
    [/^metros?$|^mts?\.?$|^m$/, 'metro'],
    [/^kilos?$|^kilogramos?$|^kgs?\.?$/, 'kg'],
    [/^gramos?$|^grs?\.?$/, 'gramo'],
    [/^piezas?$|^pzas?\.?$|^pz$/, 'pieza'],
    [/^cajas?$/, 'caja'], [/^paquetes?$|^paq\.?$/, 'paquete'], [/^gal[oó]n(?:es)?$/, 'galón'],
    [/^bolsas?$/, 'bolsa'], [/^rollos?$/, 'rollo'], [/^horas?$|^hrs?\.?$/, 'hora'],
    [/^servicios?$/, 'servicio'], [/^juegos?$/, 'juego'], [/^par(?:es)?$/, 'par'],
    [/^toneladas?$|^ton\.?$/, 'tonelada'], [/^unidad(?:es)?$/, 'unidad'], [/^bultos?$/, 'bulto'],
    [/^cubetas?$/, 'cubeta'], [/^garraf(?:a|ón|on)(?:s|es)?$/, 'garrafa'], [/^botellas?$/, 'botella'],
    [/^costal(?:es)?$/, 'costal'], [/^lotes?$/, 'lote'], [/^d[ií]as?$/, 'día'], [/^docenas?$/, 'docena'],
    [/^tramos?$/, 'tramo'], [/^sacos?$/, 'saco'], [/^botes?$/, 'bote'], [/^frascos?$/, 'frasco'],
    [/^tambos?$/, 'tambo'], [/^viajes?$/, 'viaje'], [/^cajas?$/, 'caja'], [/^tarimas?$/, 'tarima'],
  ];

  function unitOf(word) {
    const w = String(word || '').toLowerCase().trim();
    for (const [re, u] of UNITS) if (re.test(w)) return u;
    return null;
  }

  const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
  const CUR = '(?:\\s*(?:pesos?|mxn|m\\.?n\\.?|varos))?';
  const QUAL = '((?:\\s+(?:cada\\s+\\S+|c/u|la\\s+\\S+|el\\s+\\S+|por\\s+\\S+|pesos|mxn))*)';
  const RE_A = new RegExp('^' + NUM + '\\s+(.+?)\\s*(?:(?:a|en|@|por|de|a\\s+raz[oó]n\\s+de|a\\s+precio\\s+de)\\s+\\$?\\s*|\\$\\s*)' + NUM + CUR + QUAL + '$', 'iu');
  const RE_B = new RegExp('^' + NUM + '\\s+(.+)$', 'iu');
  const RE_C = new RegExp('^(\\D.*?)\\s*(?:(a|en|por|de|:|=|cuesta|vale|con\\s+(?:costo|precio)\\s+de|a\\s+precio\\s+de)\\s*)?\\$?\\s*' + NUM + CUR + QUAL + '$', 'iu');

  function preprocess(text) {
    let t = ' ' + String(text || '').replace(/[“”"«»]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    t = t.replace(/(\d+)\s*pesos\s+con\s+(\d{1,2})(?:\s*centavos|(?!\d|\s*%|\s*por\s*ciento))/gi, (_, a, b) => a + '.' + b.padStart(2, '0') + ' pesos');
    let prev;
    do { prev = t; t = t.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); } while (t !== prev);
    t = t.replace(/(\d+)\s+mil(?:\s+(\d{1,3}))?\b/gi, (_, a, b) => String(parseInt(a, 10) * 1000 + (b ? parseInt(b, 10) : 0)));
    t = t.replace(/\$\s+/g, '$');
    t = t.replace(/(\d)\s*%/g, '$1%');
    t = t.replace(/(?<!\p{L})(?:por\s+favor|porfa)(?!\p{L})[,]?/giu, ' ');
    return t.replace(/[.\s]+$/, '').trim();
  }

  function wordToNum(t) {
    const re = new RegExp('^(' + NW + ')\\b', 'iu');
    return t.replace(re, (w) => String(NUM_WORDS[w.toLowerCase()]));
  }

  function numOrWord(s) {
    const n = NUM_WORDS[String(s).toLowerCase()];
    return n !== undefined ? n : parseFloat(s);
  }

  function capitalize(s) {
    s = String(s || '').trim();
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  function cleanSeg(s) {
    let prev;
    s = s.trim();
    do {
      prev = s;
      s = s.replace(/^(?:y|e|de|con|m[aá]s|adem[aá]s|tambi[eé]n|incluye|incluyendo|agrega|agr[eé]gale|:|-)\s+/i, '')
        .replace(/\s+(?:y|con|m[aá]s|de)$/i, '')
        .replace(/^[,;:.\-\s]+|[,;:.\-\s]+$/g, '')
        .trim();
    } while (s !== prev);
    return s;
  }

  function newId() {
    return 'i' + Math.random().toString(36).slice(2, 9);
  }

  /* ---------- extracción de campos globales ---------- */

  // Verbos de instrucción para IVA: agrega/agrégale, suma/súmale, ponle, añade/añádele, carga/cárgale, incluye/inclúyele…
  const IVA_VERB = '(?:agr[eé]ga(?:r|le|lo)?|s[uú]ma(?:r|le|lo)?|pon(?:er|le)?|p[oó]nle|a[nñ][aá]de(?:r|le)?|a[nñ][aá]dele|c[aá]rga(?:r|le)?|consid[eé]ra(?:r|le)?|incl[uú]ye(?:le)?|m[eé]te(?:le)?)';
  const IVA_TAIL = '(?:\\s+(?:del?\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:%|por\\s*ciento))?';
  const IVA_RATE = '(?:(?:el\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:%|por\\s*ciento)\\s+(?:de\\s+)?)?';

  function extractIva(t) {
    const rules = [
      ['incluido', new RegExp('(?:con\\s+)?(?:el\\s+)?iva\\s+incluido' + IVA_TAIL + '|(?:ya\\s+)?incluye(?:ndo)?\\s+(?:el\\s+)?iva|ya\\s+con\\s+(?:el\\s+)?iva|precios?\\s+con\\s+iva|iva\\s+ya\\s+incluido', 'iu')],
      ['sin', new RegExp('sin\\s+(?:el\\s+)?iva|exento\\s+de\\s+iva|no\\s+(?:le\\s+)?(?:pongas|agregues|sumes|cobres)\\s+(?:el\\s+)?iva', 'iu')],
      ['mas', new RegExp('(?<!\\p{L})(?:(?:y\\s+)?(?:m[aá]s|\\+)\\s*' + IVA_RATE + '(?:el\\s+)?iva' + IVA_TAIL + '|(?:y\\s+)?' + IVA_VERB + '\\s+' + IVA_RATE + '(?:el\\s+)?iva' + IVA_TAIL + '|con\\s+' + IVA_RATE + '(?:el\\s+)?iva' + IVA_TAIL + '|(?:el\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:%|por\\s*ciento)\\s+de\\s+iva|m[aá]s\\s+impuestos)(?!\\p{L})', 'iu')],
    ];
    for (const [mode, re] of rules) {
      const m = re.exec(t);
      if (m) {
        const rate = m.slice(1).find((x) => x !== undefined);
        // quita todas las repeticiones de frases de IVA ("más IVA ... más IVA")
        const g = new RegExp(re.source, 'giu');
        return { mode, rateBp: rate ? M.toBp(rate) : null, rest: t.replace(g, ' ') };
      }
    }
    return { mode: null, rateBp: null, rest: t };
  }

  function extractValidity(t) {
    const re = new RegExp('(?:con\\s+)?(?:una\\s+)?(?:vigencia|v[aá]lid[ao]|vigente)\\s+(?:de\\s+|por\\s+|a\\s+)?(\\d+|' + NW + ')\\s*(d[ií]as?|semanas?|mes(?:es)?)', 'iu');
    const re2 = new RegExp('(?:con\\s+|por\\s+|de\\s+)?(\\d+|' + NW + ')\\s*(d[ií]as?|semanas?|mes(?:es)?)\\s+de\\s+vigencia', 'iu');
    const m = re.exec(t) || re2.exec(t);
    if (!m) return { days: null, rest: t };
    const n = numOrWord(m[1]);
    const u = m[2].toLowerCase();
    const days = u.startsWith('sem') ? n * 7 : u.startsWith('mes') ? n * 30 : n;
    return { days: Math.round(days), rest: t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length) };
  }

  function extractDiscount(t) {
    const lead = '(?:(?:d[aá]le(?:s)?|aplica(?:r|le)?|hazle|con|y|incluye)\\s+)?(?:un\\s+|el\\s+)?';
    const pct = new RegExp(lead + '(?:descuento\\s+(?:del?\\s+)?' + NUM + '\\s*(?:%|por\\s*ciento)|' + NUM + '\\s*(?:%|por\\s*ciento)\\s+(?:de\\s+)?(?:descuento|desc\\.?))', 'iu');
    let m = pct.exec(t);
    if (m) {
      return { discount: { type: 'pct', value: M.toBp(m[1] || m[2]) }, rest: t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length) };
    }
    const amt = new RegExp(lead + 'descuento\\s+de\\s+\\$?' + NUM + CUR, 'iu');
    m = amt.exec(t);
    if (m) {
      return { discount: { type: 'amount', value: M.toCents(m[1]) }, rest: t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length) };
    }
    if (/descuento/i.test(t)) return { discount: null, rest: t.replace(/(?:con\s+|y\s+)?(?:un\s+)?descuento/i, ' '), unclear: true };
    return { discount: null, rest: t };
  }

  function extractNotes(t) {
    const m = /(?:^|[,.;]\s*|\s)(?:notas?|observaci[oó]n(?:es)?)\s*:\s*(.+)$|(?:^|[,.;]\s*)(?:notas?|observaci[oó]n(?:es)?)\s+(.+)$/iu.exec(t);
    if (!m) return { notes: '', rest: t };
    return { notes: capitalize((m[1] || m[2]).trim()), rest: t.slice(0, m.index) };
  }

  const COMMAND = /^(?:(?:oye|por\s+favor|porfa|hola)[\s,]+)*(?:(?:me\s+)?(?:puedes|podr[ií]as|puede|podr[ií]a|quiero\s+que|necesito\s+que)\s+(?:me\s+)?)?(?:(?:haz(?:me)?|hacer(?:me)?|genera(?:r|me)?|crea(?:r|me)?|prepara(?:r|me)?|necesito|quiero|nueva|elabora(?:r)?)\s+(?:una\s+|la\s+)?cotizaci[oó]n|cot[ií]z(?:a|ar|ame|ale|arme|arle|aci[oó]n)?)(?=\s|,|:|$)[\s,:]*/iu;

  function isCap(tok) {
    return /^\p{Lu}/u.test(tok);
  }
  function isQtyTok(tok) {
    return /^\$?\d/.test(tok) || new RegExp('^(?:' + NW + ')$', 'iu').test(tok);
  }

  // Devuelve { client, rest, doubtful }
  function extractClient(t) {
    const lead = /^(?:a\s+la\s+|a\s+los\s+|al\s+cliente\s+|al\s+|a\s+|para\s+el\s+cliente\s+|para\s+la\s+|para\s+|cliente:?\s+)(.*)$/iu.exec(t);
    if (lead) {
      const toks = lead[1].split(' ');
      const taken = [];
      let doubtful = false;
      if (toks.length && isCap(toks[0]) && !isQtyTok(toks[0])) {
        for (let i = 0; i < toks.length; i++) {
          const tk = toks[i];
          const bare = tk.replace(/[,;:]$/, '');
          const next = toks[i + 1] || '';
          if (isCap(bare) && !/^\d/.test(bare)) taken.push(bare);
          else if (/^(?:de|del|la|las|los|y|e|&)$/i.test(bare) && isCap(next) && taken.length) taken.push(bare);
          else break;
          if (bare !== tk) break; // terminó en coma
        }
      } else {
        for (let i = 0; i < toks.length; i++) {
          const tk = toks[i];
          const bare = tk.replace(/[,;:]$/, '');
          const next = toks[i + 1] || '';
          if (isQtyTok(bare)) break;
          if (/^de$/i.test(bare) && isQtyTok(next)) break;
          taken.push(bare);
          if (bare !== tk) break;
        }
        if (taken.length === toks.length && taken.length > 1) {
          taken.splice(1);
          doubtful = true;
        } else if (taken.length > 3) doubtful = true;
      }
      if (taken.length) {
        const rest = toks.slice(taken.length).join(' ');
        let client = taken.join(' ').replace(/^(?:el|la)\s+/i, '');
        if (client === client.toLowerCase()) client = client.replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\s(De|Del|La|Las|Los|Y)(?=\s)/g, (w) => w.toLowerCase());
        return { client, rest, doubtful };
      }
    }
    // "... para Juan" en cualquier parte
    const any = /(?:^|\s)para\s+((?:\p{Lu}[\p{L}.&]*)(?:\s+(?:(?:de|del|la|los|y)\s+)?\p{Lu}[\p{L}.&]*)*)/u.exec(t);
    if (any) {
      return { client: any[1], rest: t.slice(0, any.index) + ' ' + t.slice(any.index + any[0].length), doubtful: false };
    }
    const tail = /(?:^|\s)para\s+((?:el\s+|la\s+)?[\p{L}][\p{L}.&]*(?:\s+[\p{L}][\p{L}.&]*){0,3})$/u.exec(t);
    if (tail && !/\d/.test(tail[1])) {
      const client = tail[1].replace(/^(?:el|la)\s+/i, '').replace(/(^|\s)(\p{Ll})/gu, (_, x, y) => x + y.toUpperCase());
      return { client, rest: t.slice(0, tail.index), doubtful: true };
    }
    return { client: '', rest: t, doubtful: false };
  }

  const SPLIT = new RegExp(
    '\\s*[;,]\\s*' +
      '|\\s+y\\s+(?=\\$?\\d|(?:' + NW + ')\\s)' +
      '|(?<=\\d(?:\\s*(?:pesos?|mxn))?(?:\\s+(?:cada\\s+\\S+|c/u|la\\s+\\S+|el\\s+\\S+))?)\\s+(?:y|m[aá]s|adem[aá]s|tambi[eé]n)\\s+',
    'iu'
  );

  /* ---------- conceptos ---------- */

  function splitUnit(rest) {
    const r = rest.replace(/^de\s+/i, '').trim();
    // intenta 2 palabras (metros cuadrados) y luego 1
    const words = r.split(' ');
    for (const n of [2, 1]) {
      if (words.length > n) {
        const u = unitOf(words.slice(0, n).join(' '));
        if (u) return { unit: u, desc: words.slice(n).join(' ').replace(/^de\s+/i, '').trim() };
      }
    }
    if (words.length === 1 && unitOf(words[0])) return { unit: unitOf(words[0]), desc: capitalize(words[0]) };
    return { unit: null, desc: r };
  }

  function unitFromQual(q) {
    const m = /(?:cada|la|el|por)\s+(\S+)/i.exec(q || '');
    if (!m) return null;
    return unitOf(m[1]);
  }

  function parseSegment(seg) {
    const s = wordToNum(seg);
    let m = RE_A.exec(s);
    if (m) {
      const su = splitUnit(m[2]);
      return {
        desc: capitalize(su.desc), qtyMilli: M.toMilli(m[1]), unit: su.unit || unitFromQual(m[5]),
        priceCents: M.toCents(m[3]), src: { qty: true, price: true, unit: !!su.unit },
      };
    }
    m = RE_B.exec(s);
    if (m && !/^\d+(?:\.\d+)?$/.test(m[2])) {
      const su = splitUnit(m[2]);
      return { desc: capitalize(su.desc), qtyMilli: M.toMilli(m[1]), unit: su.unit, priceCents: null, src: { qty: true, price: false, unit: !!su.unit } };
    }
    m = RE_C.exec(s);
    if (m) {
      const marker = (m[2] || '').toLowerCase();
      const qualUnit = unitFromQual(m[5]);
      const perUnit = marker === 'a' || /cada|c\/u|el\s|la\s|por\s/i.test(m[5] || '');
      return {
        desc: capitalize(m[1].replace(/^de\s+/i, '')),
        qtyMilli: perUnit ? null : 1000,
        unit: qualUnit || (perUnit ? null : 'servicio'),
        priceCents: M.toCents(m[3]),
        src: { qty: !perUnit, price: true, unit: !!qualUnit, lump: !perUnit },
      };
    }
    return { desc: capitalize(s), qtyMilli: null, unit: null, priceCents: null, src: { qty: false, price: false, unit: false } };
  }

  /* ---------- limpieza final de descripción ----------
   * Se ejecuta después de extraer cliente/IVA/vigencia/descuento/precio.
   * Solo quita frases de control reconocidas en los bordes (o frases de IVA/vigencia/
   * descuento completas, que nunca son nombre de producto); el resto se conserva tal cual. */
  const RESIDUE = /^(?:y|e|con|m[aá]s|de|a|por|para|pesos?|mxn|iva|vigencia|descuento|cada\s+un[oa]|c\/u|oye|cotiza\w*)$/iu;

  function cleanDesc(desc, client) {
    let d = ' ' + String(desc || '') + ' ';
    // frases de control completas en cualquier posición
    d = extractIva(d).rest;
    d = extractValidity(d).rest;
    d = extractDiscount(d).rest;
    d = d.replace(/\s+/g, ' ').trim();
    let prev;
    do {
      prev = d;
      d = d.replace(COMMAND, '');
      if (client) {
        const c = client.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        d = d.replace(new RegExp('^(?:a|al|para)\\s+' + c + '(?!\\p{L})\\s*', 'iu'), '');
      }
      d = d
        .replace(/^(?:y|e|con|m[aá]s|adem[aá]s|tambi[eé]n|de|oye)(?:\s+|$)/iu, '')
        // precio que quedó pegado al final: "a 80 pesos", "$80", "80 pesos"
        .replace(/\s+(?:(?:a|en|por|de)\s+)?\$\s*\d+(?:\.\d+)?(?:\s*(?:pesos?|mxn))?$/iu, '')
        .replace(/\s+(?:(?:a|en|por|de)\s+)?\d+(?:\.\d+)?\s*(?:pesos?|mxn)$/iu, '')
        // indicadores de precio unitario / moneda al final
        .replace(/\s+(?:cada\s+un[oa]|c\/u|pesos?|mxn)$/iu, '')
        .replace(/\s+(?:y|e|con|m[aá]s|de|a|por|en)$/iu, '')
        .replace(/^[,;:.\-\s]+|[,;:.\-\s]+$/g, '')
        .trim();
    } while (d !== prev);
    return RESIDUE.test(d) ? '' : capitalize(d);
  }

  /* ---------- API ---------- */

  function parse(text, context) {
    const ctx = context || {};
    const catalog = ctx.catalog || [];
    const settings = ctx.settings || {};
    const recognized = [];
    const doubtful = [];
    const unparsed = [];

    let t = preprocess(text);
    t = t.replace(COMMAND, '');

    const notes = extractNotes(t); t = notes.rest;
    const iva = extractIva(t); t = iva.rest;
    const val = extractValidity(t); t = val.rest;
    const disc = extractDiscount(t); t = disc.rest;
    t = t.replace(/\s+/g, ' ').trim();
    const cli = extractClient(t); t = cli.rest.trim();

    if (cli.client) {
      recognized.push('cliente');
      if (cli.doubtful) doubtful.push({ field: 'cliente', message: 'Revisa el nombre del cliente.' });
    } else doubtful.push({ field: 'cliente', message: 'No se identificó el cliente.' });

    if (iva.mode) recognized.push('iva');
    else doubtful.push({ field: 'iva', message: 'No se mencionó IVA; se aplicó la configuración predeterminada.' });
    if (val.days) recognized.push('vigencia');
    if (disc.discount) recognized.push('descuento');
    if (disc.unclear) doubtful.push({ field: 'descuento', message: 'Se mencionó un descuento pero no su valor.' });
    if (notes.notes) recognized.push('notas');

    const items = [];
    const segs = t.split(SPLIT).map(cleanSeg).filter((x) => x && !/^(?:por\s+favor|gracias|porfa)$/i.test(x));
    for (const seg of segs) {
      if (RESIDUE.test(seg)) continue;
      const p = parseSegment(seg);
      p.desc = cleanDesc(p.desc, cli.client);
      if (!p.desc) {
        if (p.qtyMilli !== null || p.priceCents !== null) unparsed.push(seg);
        continue;
      }
      const item = { id: newId(), desc: p.desc, qtyMilli: p.qtyMilli, unit: p.unit, priceCents: p.priceCents, flags: [], candidates: [], priceSource: p.priceCents !== null ? 'dicho' : null };
      const found = C.find(catalog, p.desc);
      if (found.match) {
        if (item.priceCents === null) {
          item.priceCents = found.match.priceCents;
          item.priceSource = 'catalogo';
          item.catalogName = found.match.name;
          item.flags.push(found.exact ? 'precio_catalogo' : 'precio_catalogo_aprox');
        }
        if (!item.unit && found.match.unit) item.unit = found.match.unit;
      } else if (found.candidates.length && item.priceCents === null) {
        item.candidates = found.candidates.map((e) => ({ name: e.name, unit: e.unit, priceCents: e.priceCents }));
        item.flags.push('ambiguo');
      }
      if (item.qtyMilli === null) item.flags.push('sin_cantidad');
      if (item.priceCents === null) item.flags.push('sin_precio');
      if (!item.unit) item.unit = p.src.lump ? 'servicio' : 'pieza';
      items.push(item);
    }

    if (items.length) recognized.push('conceptos');
    else doubtful.push({ field: 'conceptos', message: 'No se identificaron conceptos.' });
    for (const it of items) {
      if (it.flags.includes('ambiguo')) doubtful.push({ field: 'concepto', id: it.id, message: `"${it.desc}" coincide con varios productos del catálogo; elige uno.` });
      if (it.flags.includes('sin_cantidad')) doubtful.push({ field: 'cantidad', id: it.id, message: `Falta la cantidad de "${it.desc}".` });
      if (it.flags.includes('sin_precio') && !it.flags.includes('ambiguo')) doubtful.push({ field: 'precio', id: it.id, message: `Falta el precio de "${it.desc}".` });
      if (it.flags.includes('precio_catalogo_aprox')) doubtful.push({ field: 'precio', id: it.id, message: `Se usó el precio de "${it.catalogName}" del catálogo; confírmalo.` });
    }

    const incomplete = items.filter((i) => i.qtyMilli === null || i.priceCents === null).length;
    let confidence = 'alta';
    if (!items.length || incomplete === items.length) confidence = 'baja';
    else if (doubtful.some((d) => d.field !== 'iva') || unparsed.length) confidence = 'media';

    const ivaRateBp = iva.rateBp !== null && iva.rateBp !== undefined ? iva.rateBp : settings.ivaRateBp !== undefined ? settings.ivaRateBp : 1600;
    return {
      quote: {
        client: cli.client,
        items,
        discount: disc.discount || { type: 'pct', value: 0 },
        ivaMode: iva.mode || settings.ivaMode || 'mas',
        ivaRateBp,
        validityDays: val.days || settings.validityDays || 15,
        notes: notes.notes,
      },
      recognized,
      doubtful,
      unparsed,
      confidence,
    };
  }

  QF.parser = { parse, preprocess, unitOf };
  if (typeof module !== 'undefined') module.exports = QF.parser;
})(typeof globalThis !== 'undefined' ? globalThis : this);
