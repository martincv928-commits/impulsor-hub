/* Widget de chat para sitios web (modo Cliente). Uso:
   <script src=".../widget.js" data-token="TOKEN" data-api="URL_API" data-key="PUBLISHABLE_KEY"></script> */
(function () {
  var s = document.currentScript; if (!s) return;
  var token = s.getAttribute('data-token'), api = s.getAttribute('data-api'), key = s.getAttribute('data-key') || '';
  var title = s.getAttribute('data-title') || 'Asistente', color = s.getAttribute('data-color') || '#0f766e';
  if (!token || !api) return;
  var conv = null, busy = false;
  var host = document.createElement('div'); host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;font:15px/1.4 system-ui,sans-serif';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>*{box-sizing:border-box}button{cursor:pointer;font:inherit}' +
    '.fab{width:56px;height:56px;border-radius:50%;border:0;background:' + color + ';color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.3)}' +
    '.box{display:none;flex-direction:column;width:min(360px,calc(100vw - 32px));height:min(480px,calc(100vh - 100px));background:#fff;color:#14181b;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.3);overflow:hidden;margin-bottom:10px}' +
    '.hd{background:' + color + ';color:#fff;padding:10px 14px;display:flex;justify-content:space-between}.hd button{background:none;border:0;color:#fff;font-size:18px}' +
    '.ms{flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px}.m{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;background:#eef1f3}.u{align-self:flex-end;background:' + color + ';color:#fff}' +
    '.f{display:flex;gap:6px;padding:8px;border-top:1px solid #dfe3e6}.f input{flex:1;padding:9px;border:1px solid #cfd5d9;border-radius:8px;font:inherit}.f button{background:' + color + ';color:#fff;border:0;border-radius:8px;padding:0 14px}' +
    '</style><div class="box" id="b"><div class="hd"><span id="t"></span><button id="x" aria-label="Cerrar">×</button></div><div class="ms" id="m"></div>' +
    '<form class="f" id="f"><input id="i" maxlength="1000" placeholder="Escribe tu pregunta…" autocomplete="off"><button>Enviar</button></form></div><button class="fab" id="o" aria-label="Abrir chat">💬</button>';
  var $ = function (id) { return root.getElementById(id); };
  $('t').textContent = title;
  function add(text, cls) { var d = document.createElement('div'); d.className = 'm ' + (cls || ''); d.textContent = text; $('m').appendChild(d); $('m').scrollTop = 1e9; return d; }
  $('o').onclick = function () { $('b').style.display = 'flex'; $('o').style.display = 'none'; if (!$('m').children.length) add('Hola, ¿en qué te puedo ayudar?'); };
  $('x').onclick = function () { $('b').style.display = 'none'; $('o').style.display = 'block'; };
  $('f').onsubmit = function (e) {
    e.preventDefault(); var t = $('i').value.trim(); if (!t || busy) return; $('i').value = ''; add(t, 'u'); busy = true; var w = add('…');
    fetch(api, { method: 'POST', headers: { 'content-type': 'application/json', apikey: key, authorization: 'Bearer ' + key },
      body: JSON.stringify({ action: 'chat', channel_token: token, conversation_id: conv, message: t }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) { if (r.ok) { conv = r.j.conversation_id; w.textContent = r.j.reply; } else w.textContent = r.j.error || 'No pude responder.'; })
      .catch(function () { w.textContent = 'No pude conectarme. Intenta de nuevo.'; })
      .then(function () { busy = false; });
  };
  document.body.appendChild(host);
})();
