"""M2.6.1 SPEC sections I/P: the Windows build config must never embed an
Agent token or any other secret -- the token is always generated at
runtime, on the machine the Agent actually runs on (app/core/security.py)."""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
_SUSPICIOUS = re.compile(r"IMPULSOR_HUB_AGENT_TOKEN\s*[:=]\s*['\"a-zA-Z0-9_\-]{8,}")


def test_windows_workflow_has_no_embedded_token():
    workflow = REPO_ROOT / ".github" / "workflows" / "windows-build.yml"
    text = workflow.read_text()
    assert not _SUSPICIOUS.search(text)
    assert "secrets." not in text  # this build needs no repo secrets at all


def test_windows_launcher_bat_has_no_embedded_token():
    bat = REPO_ROOT / "windows" / "ImpulsorHub-Start.bat"
    text = bat.read_text()
    assert not _SUSPICIOUS.search(text)


def test_launcher_py_never_hardcodes_a_token():
    launcher = REPO_ROOT / "app" / "launcher.py"
    text = launcher.read_text()
    assert "IMPULSOR_HUB_AGENT_TOKEN" not in text


_ACCESS_CODE_SUSPICIOUS = re.compile(r"IMPULSOR_HUB_CLOUD_ACCESS_CODE\s*[:=]\s*['\"a-zA-Z0-9_\-]{4,}")


def test_cloud_agent_dockerfile_never_hardcodes_the_access_code_or_a_token():
    dockerfile = REPO_ROOT / "docker" / "Dockerfile.cloud-agent"
    text = dockerfile.read_text()
    assert not _SUSPICIOUS.search(text)
    assert not _ACCESS_CODE_SUSPICIOUS.search(text)
    assert "ENV IMPULSOR_HUB_CLOUD_ACCESS_CODE" not in text
