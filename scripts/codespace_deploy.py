"""One authorized deployment to the owner's existing Codespace.

GitHub CLI owns OAuth/SSH. Never prints its credential or the Hub launch link.
The link is RSA-OAEP encrypted to this session's public key before publication.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import urllib.request

REPO = 'martincv928-commits/impulsor-hub'
OWNER = 'martincv928-commits'
CONTEXT = 'impulsor-hub/codespace-deploy'
ROOT = Path(__file__).resolve().parents[1]


class DeploymentError(Exception):
    pass


def api(path: str, data: dict, status_token: str) -> dict:
    request = urllib.request.Request(
        'https://api.github.com/' + path, json.dumps(data).encode(),
        {'Authorization': 'Bearer ' + status_token, 'Accept': 'application/vnd.github+json',
         'Content-Type': 'application/json', 'User-Agent': 'impulsor-hub-deploy'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def publish(state: str, description: str, target_url: str | None = None) -> None:
    target = target_url or f'https://github.com/{REPO}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
    api(f'repos/{REPO}/statuses/{os.environ["GITHUB_SHA"]}', {
        'state': state, 'context': CONTEXT, 'description': description[:140], 'target_url': target,
    }, os.environ['STATUS_TOKEN'])


def select_codespace(items: list[dict], login: str) -> dict:
    if login.casefold() != OWNER.casefold():
        raise DeploymentError('La autorización no pertenece al propietario esperado.')
    candidates = [item for item in items
                  if item.get('repository', {}).get('full_name', '').casefold() == REPO.casefold()
                  and item.get('owner', {}).get('login', '').casefold() == login.casefold()]
    active = [item for item in candidates if item.get('state') == 'Available']
    choices = active if active else candidates
    if len(choices) != 1:
        raise DeploymentError('No hay un único Codespace identificable; no se modificó ninguno.')
    chosen = choices[0]
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]+', chosen.get('name', '')):
        raise DeploymentError('Nombre de Codespace no válido.')
    return chosen


def run_gh(args: list[str], env: dict, timeout: int = 120) -> str:
    result = subprocess.run(['gh', *args], env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # CLI diagnostics can contain remote output. Do not echo them publicly.
        raise DeploymentError('GitHub CLI no pudo completar la operación solicitada.')
    return result.stdout


def encrypt_link(link: str, public_key: Path) -> str:
    if len(link.encode()) > 446:
        raise DeploymentError('El enlace supera el límite de cifrado; no se publicará.')
    result = subprocess.run([
        'openssl', 'pkeyutl', '-encrypt', '-pubin', '-inkey', str(public_key),
        '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256',
    ], input=link.encode(), capture_output=True)
    if result.returncode:
        raise DeploymentError('No se pudo cifrar el enlace privado.')
    return base64.b64encode(result.stdout).decode()


def authorize(env: dict) -> None:
    # The runner's repository token must never substitute for the user's OAuth.
    if env.get('GH_TOKEN') or env.get('GITHUB_TOKEN'):
        raise DeploymentError('El entorno mezcla credenciales del repositorio y del usuario.')
    publish('pending', 'Solicitando autorización para el Codespace existente.')
    process = subprocess.Popen([
        'gh', 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https',
        '--web', '--scopes', 'codespace',
    ], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for line in process.stdout:
            match = re.search(r'\b[A-Z0-9]{4}-[A-Z0-9]{4}\b', line)
            if match:
                code = match.group()
                publish('pending', 'Esperando autorización de GitHub CLI (Codespaces).',
                        'https://github.com/login/device?user_code=' + code)
                print('Enlace de autorización preparado en el estado del commit.', flush=True)
        if process.wait(timeout=930):
            raise DeploymentError('La autorización no se completó o expiró.')
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()


def main() -> None:
    if os.environ.get('GITHUB_REPOSITORY') != REPO or os.environ.get('GITHUB_REF') != 'refs/heads/master':
        raise DeploymentError('Solo se permite desplegar este repositorio desde master.')
    revision = os.environ.get('GITHUB_SHA', '')
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise DeploymentError('Revisión inválida.')
    config = tempfile.mkdtemp(prefix='impulsor-gh-')
    env = dict(os.environ, GH_CONFIG_DIR=config, GH_PROMPT_DISABLED='1', GH_BROWSER='true')
    try:
        authorize(env)
        identity = json.loads(run_gh(['api', 'user'], env))
        inventory = json.loads(run_gh(['api', '--paginate', '--slurp', f'repos/{REPO}/codespaces?per_page=100'], env))
        items = [item for page in inventory for item in page.get('codespaces', [])]
        chosen = select_codespace(items, identity['login'])
        publish('pending', 'Autorizado; desplegando y verificando el Agent existente.')
        remote = (ROOT / 'scripts' / 'codespace_deploy_remote.py').read_text()
        command = 'python -c ' + shlex.quote(remote) + ' ' + shlex.quote(revision) + ' ' + shlex.quote(chosen['name'])
        output = run_gh(['codespace', 'ssh', '--codespace', chosen['name'], '--', command], env, timeout=900)
        reports = [line for line in output.splitlines() if line.startswith('__IMPULSOR_DEPLOY_REPORT__')]
        if len(reports) != 1:
            raise DeploymentError('El Codespace no devolvió una verificación válida.')
        report = json.loads(reports[0].removeprefix('__IMPULSOR_DEPLOY_REPORT__'))
        if report.get('revision') != revision or report.get('verified') is not True:
            raise DeploymentError('La verificación del Codespace no coincide con la revisión solicitada.')
        link = report.pop('launch_url')
        if not link.startswith(f'https://{chosen["name"]}-8000.app.github.dev/#impulsor-token='):
            raise DeploymentError('El enlace no corresponde al Agent verificado.')
        report['encrypted_launch_url'] = encrypt_link(link, ROOT / '.github' / 'impulsor-deploy.pub')
        blob = api(f'repos/{REPO}/git/blobs', {
            'content': json.dumps(report), 'encoding': 'utf-8',
        }, os.environ['STATUS_TOKEN'])
        publish('success', 'Codespace verificado. Informe cifrado: ' + blob['sha'])
        print('Agent verificado en el Codespace real; enlace privado cifrado.', flush=True)
    except Exception as exc:
        message = str(exc) if isinstance(exc, DeploymentError) else type(exc).__name__
        publish('failure', message)
        raise SystemExit(message) from None
    finally:
        # Ephemeral runner storage; no OAuth tokens in artifacts, outputs or git.
        shutil.rmtree(config, ignore_errors=True)


if __name__ == '__main__':
    main()
