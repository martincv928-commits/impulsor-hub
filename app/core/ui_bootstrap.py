"""Bootstrap only a local owner or a browser holding an owner-issued link.

Codespaces URLs are not proof of identity. A launch capability travels in the
fragment (never sent in HTTP requests/logs) and stays in this tab's session.
"""
from __future__ import annotations

import json
import os

from fastapi import Request

from app.core.security import get_or_create_agent_token


def bootstrap_html(index: str, request: Request) -> str:
    local = (
        not os.environ.get("CODESPACES")
        and not os.environ.get("CODESPACE_NAME")
        and not os.environ.get("IMPULSOR_HUB_CLOUD_ACCESS_CODE")
        and request.client is not None
        and request.client.host in {"127.0.0.1", "::1"}
        and request.url.hostname in {"localhost", "127.0.0.1", "::1"}
        and not request.headers.get("x-forwarded-host")
        and not request.headers.get("x-forwarded-for")
        and not request.headers.get("forwarded")
    )
    token = get_or_create_agent_token() if local else None
    encoded = json.dumps(token).replace("<", "\\u003c")
    script = """<script>
(() => {
  const key = 'impulsor-hub-same-origin-token';
  const fragment = new URLSearchParams(location.hash.slice(1));
  let token = LOCAL_TOKEN;
  const launchToken = fragment.get('impulsor-token');
  if (launchToken) {
    token = launchToken;
    fragment.delete('impulsor-token');
    const rest = fragment.toString();
    history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
  }
  try {
    token = token || sessionStorage.getItem(key);
    if (token) sessionStorage.setItem(key, token);
  } catch (_) { /* This load still works if browser storage is disabled. */ }
  if (token) {
    window.__IMPULSOR_AGENT_TOKEN__ = token;
    window.__IMPULSOR_SAME_ORIGIN__ = true;
    try {
      for (const old of ['impulsor-hub-workspace-mode', 'impulsor-hub-cloud-token', 'impulsor-hub-cloud-url']) {
        localStorage.removeItem(old);
      }
    } catch (_) { /* The in-memory bootstrap also overrides old storage. */ }
  }
})();
</script>""".replace("LOCAL_TOKEN", encoded)
    if "<head>" in index:
        return index.replace("<head>", "<head>" + script, 1)
    return script + index
