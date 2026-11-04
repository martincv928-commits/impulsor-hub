"""Stamp/check the UI sources used for a Codespaces build; no credentials."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


def source_fingerprint(root: Path) -> str:
    digest = hashlib.sha256()
    paths = list((root / 'src').rglob('*'))
    paths += [root / name for name in ('index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json')]
    for path in sorted(p for p in paths if p.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b'\0')
        digest.update(path.read_bytes())
        digest.update(b'\0')
    return digest.hexdigest()


def build_info(root: Path) -> dict:
    stamp = root / 'dist' / 'impulsor-build.json'
    info = json.loads(stamp.read_text()) if stamp.is_file() else {}
    if os.environ.get('CODESPACES') or os.environ.get('CODESPACE_NAME'):
        if info.get('source_fingerprint') != source_fingerprint(root):
            raise RuntimeError('Frontend desactualizado: ejecutar .devcontainer/start-hub.sh')
    return info


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2] / 'ui'
    (root / 'dist' / 'impulsor-build.json').write_text(json.dumps({
        'source_fingerprint': source_fingerprint(root),
        'revision': os.environ.get('IMPULSOR_HUB_CODE_REVISION', 'unknown'),
    }))
