"""Executed over GitHub CLI's authenticated tunnel, only in the chosen Codespace."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

REPO = 'martincv928-commits/impulsor-hub'
FIX = 'e511f4698564bffc7cb4eec40bd44348309417ec'


def run(args: list[str], cwd: Path, *, timeout: int = 120, env: dict | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # Never echo captured start-hub output: it contains an owner capability.
        raise RuntimeError('Falló un paso del despliegue; se conserva el checkout original.')
    return result.stdout.strip()


def main() -> None:
    revision, name = sys.argv[1:]
    if not re.fullmatch(r'[a-f0-9]{40}', revision) or os.environ.get('CODESPACE_NAME') != name:
        raise RuntimeError('Identidad del Codespace o revisión incorrecta.')
    if os.environ.get('GITHUB_REPOSITORY', REPO).casefold() != REPO.casefold():
        raise RuntimeError('Repositorio del Codespace incorrecto.')
    candidates = []
    for path in Path('/workspaces').iterdir():
        if not path.is_dir() or not (path / '.git').exists():
            continue
        origin = run(['git', 'remote', 'get-url', 'origin'], path).rstrip('/').removesuffix('.git')
        if origin in {f'https://github.com/{REPO}', f'git@github.com:{REPO}'}:
            candidates.append(path)
    if len(candidates) != 1:
        raise RuntimeError('No hay un único checkout del repositorio esperado.')
    source = candidates[0]
    run(['git', 'fetch', 'origin', 'master'], source)
    run(['git', 'merge-base', '--is-ancestor', FIX, revision], source)
    # Keep the user's dirty files, branch and commits untouched.
    deploy = source.parent / '.impulsor-hub-deployments' / revision
    if deploy.exists():
        if run(['git', 'rev-parse', 'HEAD'], deploy) != revision or run(['git', 'status', '--porcelain'], deploy):
            raise RuntimeError('La copia aislada tiene cambios; no se sobrescribirá.')
    else:
        deploy.parent.mkdir(exist_ok=True)
        run(['git', 'worktree', 'add', '--detach', str(deploy), revision], source)
    env = dict(os.environ, CODESPACES='true', IMPULSOR_HUB_DEPLOY_REVISION=revision)
    run(['bash', str(deploy / '.devcontainer' / 'start-hub.sh')], deploy, timeout=720, env=env)
    sys.path.insert(0, str(deploy))
    from app.core.security import get_or_create_agent_token
    token = get_or_create_agent_token()
    base = 'http://127.0.0.1:8000'

    def request(path: str, method: str = 'GET', auth: bool = True):
        headers = {'Authorization': 'Bearer ' + token} if auth else {}
        req = urllib.request.Request(base + path, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.read().decode()

    health = json.loads(request('/api/health', auth=False))
    if health.get('code_revision') != revision or health.get('ui_revision') != revision:
        raise RuntimeError('El proceso que escucha no corresponde a la versión desplegada.')
    # Confirm that even direct loopback HTTP in Codespaces never discloses the token.
    html = request('/', auth=False)
    if token in html or "let token = null;" not in html:
        raise RuntimeError('El HTML remoto entrega credenciales sin autorización.')
    if html.index("const key =") > html.index('type="module"'):
        raise RuntimeError('El bootstrap no precede al frontend.')
    assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html)
    if not assets:
        raise RuntimeError('No se encontró el bundle del Hub.')
    for asset in assets:
        request(asset, auth=False)
    for path, method in [('/api/projects', 'GET'), ('/api/test-game', 'POST')]:
        try:
            request(path, method=method, auth=False)
        except urllib.error.HTTPError as exc:
            if exc.code != 401:
                raise RuntimeError('Una operación sin autorización no devolvió 401.') from None
        else:
            raise RuntimeError('Una operación protegida aceptó una petición anónima.')
    before = json.loads(request('/api/projects'))
    project = json.loads(request('/api/test-game', method='POST'))
    # Reload the page and then consult the actual persisted project again.
    request('/', auth=False)
    after = json.loads(request('/api/projects'))
    persisted = json.loads(request('/api/projects/' + project['id']))
    if len(after) != len(before) + 1 or persisted['id'] != project['id']:
        raise RuntimeError('Falló la verificación de creación y lectura del proyecto.')
    from urllib.parse import quote
    link = f'https://{name}-8000.app.github.dev/#impulsor-token=' + quote(token, safe='')
    # This stdout is captured privately by the controller, never logged raw.
    print('__IMPULSOR_DEPLOY_REPORT__' + json.dumps({
        'verified': True, 'revision': revision, 'codespace': name, 'pid': health['pid'],
        'project_id': project['id'], 'projects_count': len(after), 'launch_url': link,
        'checks': ['ui-assets', 'bootstrap-before-bundle', 'anonymous-401',
                   'projects-200', 'test-project-created', 'read-after-reload'],
    }))


if __name__ == '__main__':
    main()
