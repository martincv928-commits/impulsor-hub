"""Deployment must choose the exact owner/repository and keep its link private."""
from __future__ import annotations

import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('codespace_deploy', ROOT / 'scripts' / 'codespace_deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def entry(name='existing-code-123', state='Available', repo=deploy.REPO, owner=deploy.OWNER):
    return {'name': name, 'state': state, 'repository': {'full_name': repo}, 'owner': {'login': owner}}


class DeploymentSafeguards(unittest.TestCase):
    def test_only_exact_owner_and_repository_can_be_selected(self):
        target = entry()
        others = [entry(repo='someone/other-project'), entry(owner='different-user')]
        self.assertEqual(deploy.select_codespace(others + [target], deploy.OWNER), target)
        with self.assertRaises(deploy.DeploymentError):
            deploy.select_codespace([target], 'different-user')
        with self.assertRaises(deploy.DeploymentError):
            deploy.select_codespace(others, deploy.OWNER)

    def test_ambiguous_running_codespaces_are_not_modified(self):
        with self.assertRaises(deploy.DeploymentError):
            deploy.select_codespace([entry(), entry(name='second-code-456')], deploy.OWNER)
        active = entry()
        self.assertEqual(deploy.select_codespace([entry(name='stopped-code-456', state='Shutdown'), active], deploy.OWNER), active)

    def test_invalid_codespace_name_cannot_reach_remote_command(self):
        with self.assertRaises(deploy.DeploymentError):
            deploy.select_codespace([entry(name='code; touch /tmp/unwanted')], deploy.OWNER)

    def test_launch_link_is_recoverable_only_with_private_key(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            private, public, encrypted = root / 'private.pem', root / 'public.pem', root / 'encrypted'
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:4096', '-out', str(private)], check=True, capture_output=True)
            subprocess.run(['openssl', 'pkey', '-in', str(private), '-pubout', '-out', str(public)], check=True, capture_output=True)
            link = 'https://existing-code-123-8000.app.github.dev/#impulsor-token=test-owner-capability'
            ciphertext = deploy.encrypt_link(link, public)
            self.assertNotIn('test-owner-capability', ciphertext)
            encrypted.write_bytes(base64.b64decode(ciphertext))
            result = subprocess.run(['openssl', 'pkeyutl', '-decrypt', '-inkey', str(private), '-in', str(encrypted), '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256'], capture_output=True, check=True)
            self.assertEqual(result.stdout.decode(), link)

    def test_repository_token_is_not_used_as_codespace_user_credential(self):
        with self.assertRaises(deploy.DeploymentError):
            deploy.authorize({'GH_TOKEN': 'repository-token'})
        with self.assertRaises(deploy.DeploymentError):
            deploy.authorize({'GITHUB_TOKEN': 'repository-token'})

    def test_only_main_branch_can_start_deployment(self):
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': deploy.REPO, 'GITHUB_REF': 'refs/heads/other'}):
            with self.assertRaises(deploy.DeploymentError):
                deploy.main()


if __name__ == '__main__':
    unittest.main()
