"""Run with python -m unittest discover -s tests -p test_hub_auth_regression.py.

Uses a temporary database, real test-game route and actual frontend API clients.
No Godot execution, AI provider invocation, or changes to managed projects.
"""
from __future__ import annotations

import json
import os
import asyncio
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.api import main
from app.core.ui_build import build_info, source_fingerprint


class HubAuthRegression(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {
            'IMPULSOR_HUB_AGENT_TOKEN': 'regression-owner-token',
            'IMPULSOR_HUB_DB_PATH': str(self.root / 'hub.db'),
            'IMPULSOR_HUB_TEST_PROJECTS_DIR': str(self.root / 'projects'),
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.temp.cleanup)
        self.dist = self.root / 'dist'
        (self.dist / 'assets').mkdir(parents=True)
        (self.dist / 'index.html').write_text('<head><script type="module" src="/assets/app.js"></script></head><body></body>')
        (self.dist / 'assets' / 'app.js').write_text('/* test static bundle */')
        # Use the real application and handlers, with isolated static files.
        self.original_routes = list(main.app.router.routes)
        main.app.router.routes[:] = [r for r in main.app.router.routes if getattr(r, 'path', None) not in {'/', '/assets'}]
        main.mount_ui(main.app, self.dist)
        self.addCleanup(lambda: main.app.router.routes.__setitem__(slice(None), self.original_routes))

    async def test_missing_malformed_and_wrong_tokens_remain_rejected(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
            for path, method in [('/api/projects', client.get), ('/api/test-game', client.post)]:
                for auth in [None, 'Basic bad', 'Bearer wrong']:
                    response = await method(path, headers={'Authorization': auth} if auth else {})
                    self.assertEqual(response.status_code, 401)
                    if auth is None:
                        self.assertEqual(response.json()['detail'], 'Missing or malformed Authorization header')
            response = await client.get('/api/projects', headers={'Authorization': 'Bearer regression-owner-token'})
            self.assertEqual(response.status_code, 200)

    async def test_remote_html_and_assets_never_disclose_token(self):
        with patch.dict(os.environ, {'CODESPACE_NAME': 'example-codespace'}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='https://example-codespace-8000.app.github.dev') as client:
                response = await client.get('/')
                self.assertEqual(response.status_code, 200)
                self.assertNotIn('regression-owner-token', response.text)
                self.assertEqual(response.headers['cache-control'], 'no-store')
                self.assertLess(response.text.index("const key ="), response.text.index('type="module"'))
                self.assertNotIn('regression-owner-token', (await client.get('/assets/app.js')).text)
        with patch.dict(os.environ, {'IMPULSOR_HUB_CLOUD_ACCESS_CODE': 'operator-code'}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='https://public.example') as client:
                self.assertNotIn('regression-owner-token', (await client.get('/')).text)

    async def test_loopback_direct_bootstrap_only_without_remote_or_cloud_markers(self):
        with patch.dict(os.environ, {}, clear=True):
            os.environ['IMPULSOR_HUB_DB_PATH'] = str(self.root / 'hub.db')
            os.environ['IMPULSOR_HUB_AGENT_TOKEN'] = 'regression-owner-token'
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app, client=('127.0.0.1', 1234)), base_url='http://localhost') as client:
                self.assertIn('regression-owner-token', (await client.get('/')).text)
                for header in ['x-forwarded-host', 'x-forwarded-for', 'forwarded']:
                    self.assertNotIn('regression-owner-token', (await client.get('/', headers={header: 'localhost'})).text)
                os.environ['CODESPACE_NAME'] = 'example'
                self.assertNotIn('regression-owner-token', (await client.get('/')).text)

    async def test_stale_frontend_cannot_start_in_codespaces(self):
        ui = self.root / 'ui'
        (ui / 'src').mkdir(parents=True)
        (ui / 'dist').mkdir()
        source = ui / 'src' / 'client.ts'
        source.write_text('old client')
        stamp = ui / 'dist' / 'impulsor-build.json'
        stamp.write_text(json.dumps({'source_fingerprint': source_fingerprint(ui), 'revision': 'tested'}))
        with patch.dict(os.environ, {'CODESPACE_NAME': 'example'}):
            self.assertEqual(build_info(ui)['revision'], 'tested')
            source.write_text('updated client')
            with self.assertRaisesRegex(RuntimeError, 'Frontend desactualizado'):
                build_info(ui)
            stamp.unlink()
            with self.assertRaises(RuntimeError):
                build_info(ui)

    async def asyncSetUp(self):
        # Periodic ticks also work in sandboxes that deny asyncio's wakeup socket.
        loop = asyncio.get_running_loop()
        self.ticking = True
        def tick():
            if self.ticking:
                loop.call_later(0.01, tick)
        tick()

    async def asyncTearDown(self):
        self.ticking = False

    async def test_real_frontend_clients_against_api_and_reload(self):
        env = dict(os.environ, HUB_TEST_BRIDGE='1',
                   HUB_TEST_TOKEN='regression-owner-token', PYTHON=sys.executable)
        process = subprocess.Popen(['node', 'tests/hub-auth-clients.test.mjs'],
                                   cwd=Path(__file__).resolve().parents[1], env=env,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        output = []
        requests = []
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                while True:
                    line = await asyncio.wait_for(asyncio.to_thread(process.stdout.readline), 10)
                    if not line:
                        break
                    if not line.startswith('__HUB_REQUEST__'):
                        output.append(line)
                        continue
                    request = json.loads(line[len('__HUB_REQUEST__'):])
                    requests.append(request)
                    response = await client.request(request['method'], request['url'],
                                                    headers=request['headers'], content=request.get('body'))
                    process.stdin.write(json.dumps({'status': response.status_code, 'body': response.text}) + '\n')
                    process.stdin.flush()
            code = await asyncio.wait_for(asyncio.to_thread(process.wait), 10)
            self.assertEqual(code, 0, ''.join(output) + process.stderr.read())
            self.assertEqual([r['url'] for r in requests[:3]], ['/api/projects', '/api/test-game', '/api/projects'])
            self.assertEqual(len(requests), 4)
            print(''.join(output))
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()


if __name__ == '__main__':
    unittest.main()
