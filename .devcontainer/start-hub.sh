#!/usr/bin/env bash
set -euo pipefail
cd /workspaces/impulsor-hub

# Codespaces may resume an old workspace. Always fast-forward before serving.
git pull --ff-only

# Build the UI from the same checkout the API imports.
if [ ! -d ui/dist ]; then
  (cd ui && npm install --silent && npm run build)
fi

# Stop any previous Hub instance, including the image-baked /srv copy.
python - <<'PY'
import os
for pid in os.listdir('/proc'):
    if not pid.isdigit() or int(pid) == os.getpid():
        continue
    try:
        raw = open(f'/proc/{pid}/cmdline','rb').read()
    except OSError:
        continue
    cmd = raw.replace(b'\0', b' ').decode('utf-8','replace')
    if 'uvicorn' in cmd and 'app.api.main:app' in cmd:
        try:
            os.kill(int(pid), 15)
        except OSError:
            pass
PY
sleep 1

# Force Python imports to this checkout; never /srv/impulsor-hub.
export PYTHONPATH=/workspaces/impulsor-hub
cd /workspaces/impulsor-hub
nohup python -m uvicorn app.api.main:app --host 0.0.0.0 --port 8000 > /tmp/impulsor-hub.log 2>&1 &
