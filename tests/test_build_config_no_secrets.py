"""M2.6.1 SPEC sections I/P: the Windows build config must never embed an
Agent token or any other secret -- the token is always generated at
runtime, on the machine the Agent actually runs on (app/core/security.py)."""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
_SUSPICIOUS = re.compile(r"IMPULSOR_HUB_AGENT_TOKEN\\s*[:=]\\s*['\\\"a-zA-Z0-9_\\-]{8,}")


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


_ACCESS_CODE_SUSPICIOUS = re.compile(r"IMPULSOR_HUB_CLOUD_ACCESS_CODE\\s*[:=]\\s*['\\\"a-zA-Z0-9_\\-]{4,}")


def test_cloud_agent_dockerfile_never_hardcodes_the_access_code_or_a_token():
    dockerfile = REPO_ROOT / "docker" / "Dockerfile.cloud-agent"
    text = dockerfile.read_text()
    assert not _SUSPICIOUS.search(text)
    assert not _ACCESS_CODE_SUSPICIOUS.search(text)
    assert "ENV IMPULSOR_HUB_CLOUD_ACCESS_CODE" not in text


def test_cloud_agent_installs_all_registered_ai_provider_clis():
    dockerfile = REPO_ROOT / "docker" / "Dockerfile.cloud-agent"
    text = dockerfile.read_text()
    assert "@anthropic-ai/claude-code" in text
    assert "@openai/codex" in text
    assert "@google/gemini-cli" in text


def test_cloud_launcher_can_replace_a_stale_hub_without_external_process_tools():
    launcher = REPO_ROOT / "app" / "launcher.py"
    text = launcher.read_text()
    assert "_stop_stale_hub()" in text
    assert "/proc/net/tcp" in text
    assert "pkill" not in text
    assert "fuser" not in text


def test_api_builds_frontend_when_cloud_workspace_has_no_dist():
    main = REPO_ROOT / "app" / "api" / "main.py"
    text = main.read_text()
    assert 'subprocess.run(["npm", "run", "build"]' in text
    assert "if not _UI_DIST.is_dir()" in text


def test_same_origin_auth_bootstrap_precedes_frontend_bundle():
    """The Agent token must exist before Vite modules initialize activeToken()."""
    source = Path("app/api/main.py").read_text(encoding="utf-8")
    assert 'replace("<head>", "<head>" + bootstrap, 1)' in source
    assert "json.dumps(token)" in source
