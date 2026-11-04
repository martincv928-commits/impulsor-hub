#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# A remote deployment uses an isolated worktree pinned to its reviewed commit.
if [[ -n "${IMPULSOR_HUB_DEPLOY_REVISION:-}" ]]; then
  [[ "$(git rev-parse HEAD)" == "$IMPULSOR_HUB_DEPLOY_REVISION" ]] || {
    echo 'La copia no coincide con la revisión solicitada.' >&2
    exit 1
  }
else
  # Preserve local work. Never reset or overwrite a dirty checkout.
  git fetch origin master
  if [[ -z "$(git status --porcelain)" ]]; then
    git merge --ff-only origin/master
  else
    echo 'Hay cambios locales: se conservan y se compila este checkout.' >&2
  fi
fi

export PYTHONPATH="$ROOT"
export IMPULSOR_HUB_CODE_REVISION="$(git rev-parse HEAD)"
# Never reuse the image-baked dist or an old workspace build.
(cd ui && npm ci --silent && VITE_DEMO_MODE=false BUILD_BASE_PATH=/ npm run build)
python -m app.core.ui_build

# Only terminate actual Hub uvicorn processes, not matching shell commands.
python - <<'PY'
import os
import signal
import time
from pathlib import Path
pids = []
for proc in Path('/proc').iterdir():
    if not proc.name.isdigit() or int(proc.name) == os.getpid():
        continue
    try:
        argv = (proc / 'cmdline').read_bytes().split(b'\0')
        if b'app.api.main:app' not in argv:
            continue
        if not any(Path(os.fsdecode(arg)).name == 'uvicorn' for arg in argv if arg):
            continue
        os.kill(int(proc.name), signal.SIGTERM)
        pids.append(int(proc.name))
    except (OSError, ProcessLookupError):
        continue
for _ in range(50):
    alive = [pid for pid in pids if Path(f'/proc/{pid}').exists()]
    if not alive:
        break
    time.sleep(0.2)
else:
    raise SystemExit('El Agent anterior no terminó; no se iniciará otra copia.')
PY

nohup python -m uvicorn app.api.main:app --app-dir "$ROOT" --host 0.0.0.0 --port 8000 > /tmp/impulsor-hub.log 2>&1 &
HUB_PID=$!
export IMPULSOR_HUB_EXPECTED_PID="$HUB_PID"
# Confirm the listener is the process just launched and reports this build.
python - <<'PY'
import json
import os
import time
import urllib.request
from app.core.security import get_or_create_agent_token
for _ in range(50):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=1) as response:
            health = json.load(response)
        if (health.get('pid') == int(os.environ['IMPULSOR_HUB_EXPECTED_PID'])
                and health.get('code_revision') == os.environ['IMPULSOR_HUB_CODE_REVISION']
                and health.get('ui_revision') == os.environ['IMPULSOR_HUB_CODE_REVISION']):
            break
    except (OSError, ValueError):
        pass
    time.sleep(0.2)
else:
    raise SystemExit('El nuevo Hub no está listo. Revisar /tmp/impulsor-hub.log.')
name = os.environ.get('CODESPACE_NAME')
if name:
    domain = os.environ.get('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'app.github.dev')
    origin = f'https://{name}-8000.{domain}'
else:
    origin = 'http://127.0.0.1:8000'
from urllib.parse import quote
print('Hub listo. Abre este enlace privado en tu celular (no lo compartas):')
print(origin + '/#impulsor-token=' + quote(get_or_create_agent_token(), safe=''))
PY
