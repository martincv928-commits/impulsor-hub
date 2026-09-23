# M2.7 — Mobile + Cloud Workspace

Brief, honest status report. See M1_REPORT.md / M2_REPORT.md / M2_5B_REPORT.md /
M2_6_REPORT.md / M2_6_1_REPORT.md for everything before this milestone — none
of it is repeated here.

## 1. Architecture chosen

**No second Impulsor Hub was built.** The Cloud Agent is the exact same
FastAPI backend as the local Agent, distinguished at runtime by a single
env var, `IMPULSOR_HUB_CLOUD_ACCESS_CODE`:

- Absent → local mode (unchanged since M2.6/M2.6.1): `GET /` injects the
  Agent token into the served page, meant for a single trusted user on
  their own machine.
- Present → cloud mode: `GET /` serves the page **without** the token
  (fixed in `app/api/main.py`'s `_cloud_mode()` carve-out — the token
  auto-injection that is safe on localhost would leak it to the internet
  otherwise). A client instead calls `POST /api/cloud/session` with the
  access code and receives the same Bearer token the local Agent already
  issues (`get_or_create_agent_token()`), via `secrets.compare_digest`.

Every other endpoint (projects, tasks, orchestrator, KEEP/ROLLBACK,
resources) is literally unchanged code, reused as-is. `GET /api/agent/status`
now reports `mode: "local"|"cloud"` so the frontend can label the workspace
correctly.

## 2. Local Mode preserved

No behavior change for PC users: `app/launcher.py`, the Windows CI build
(`.github/workflows/windows-build.yml`), the token auto-injection for
`GET /`, and the desktop Godot preview process (start/status/stop) are all
untouched. Full backend suite: **143 passed**, including everything from
M1/M2/M2 Hardening/M2.6/M2.6.1.

## 3. Cloud Workspace

- `app/api/routers/cloud_session.py`: access-code → token exchange. No
  OAuth, no new credential store — the access code is a single deploy-time
  secret, never committed, never sent to the frontend build.
- Isolation: a Cloud Agent deployment still uses `app/core/permissions/policy.py`'s
  existing path-boundary checks per project; there is no shared-tenant model
  in this milestone (one Cloud Agent = one workspace owner, matching the
  "controlled dev/milestone access" scope explicitly allowed by the spec).
- Persistence: SQLite (`IMPULSOR_HUB_DB_PATH`) + the project's own Git repo
  on disk, exactly like local mode — a browser reload/close just re-reads
  the same server state, no in-memory-only data.

## 4. Security (section E)

- HTTPS is a deployment-time concern (reverse proxy/TLS termination); the
  app itself is transport-agnostic.
- Every mutating endpoint requires the Bearer token (`require_agent_token`),
  including the new `/webexport/start` endpoints.
- The **preview file route** (`GET /preview/web/{export_id}/{filename}`) is
  deliberately the one unauthenticated route — a plain browser/Godot-Web
  runtime navigation can't attach an `Authorization` header. Its security
  is an unguessable `uuid4().hex` export id plus `validate_path_within_workspace`
  (reused, not reimplemented) preventing traversal outside that one export
  directory. Verified in the E2E: a `../../../etc/passwd` request against it
  returns 404.
- No generic shell endpoint exists or was added.
- Exports expire after 30 minutes and are swept on the next export request
  (no scheduler needed).
- No secret reaches the frontend build or bundle (`tests/test_build_config_no_secrets.py`
  now also checks `docker/Dockerfile.cloud-agent` for a hardcoded access
  code or token — none found, real check, not a hardcoded pass).

## 5. Claude Cloud

**REAL CLOUD CLAUDE: BLOCKED**, reported honestly per section AC, not
worked around. Reason: this sandbox's own Claude Code session is already
authenticated to *this* machine; copying that session, its `~/.claude`
directory, or its cookies/tokens to a "separate" cloud process would not
be a legitimate, independently-authenticated cloud execution — it would
never actually leave this sandbox, and section G explicitly forbids
exactly that shortcut. No cloud infrastructure or Claude API credential
was available in this environment to authenticate a genuinely separate
process. Cloud Executor's contract point is unchanged from local mode
(`AIExecutorAdapter`) — a real deployment only needs a legitimately
authenticated `claude` CLI (or API key) on that machine; nothing in the
Cloud Agent code assumes local-only auth.

**Zero real Claude executions were used for M2.7** (a deliberate
improvement over M2.6/M2.6.1, which each used 1-2). The one Cloud E2E
(section 8 below) uses `tests/fakes.py`'s `FakeAIExecutorAdapter` for the
Claude step only — real Git, real Godot validation, real Web export
around it.

## 6. Godot Web export (section M/N/O)

Real, verified Godot 4.2.2 Web export:

- Official export templates (894MB `.tpz`), checksum-verified against the
  release's own `SHA512-SUMS.txt`.
- `fixtures/impulsor_hub_test_game/export_presets.cfg` adds a `Web` preset
  to the existing Test Game fixture (no new fixture, per section K).
- `app/api/routers/webexport.py` runs `godot4 --headless --export-debug
  Web <target> --path <workspace>` (no Xvfb needed for export, unlike the
  desktop preview) and serves the resulting `index.html/.js/.wasm/.pck`
  with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` — empirically required for
  Godot 4's Web build to boot in a browser (confirmed earlier in this
  session via a real headless-Chromium render showing the actual game).
- Missing templates or a non-Web-configured project both return a clear
  409, never a fake preview.
- `docker/Dockerfile.cloud-agent` bundles Godot + the export templates
  into the image so a real Cloud Agent deployment never asks an Android
  user to install anything.

## 7. Mobile UI (sections I, J, S)

- New entry screen `ui/src/components/WorkspaceGate.tsx`: "¿DÓNDE QUIERES
  TRABAJAR?" → ☁️ Workspace remoto / 💻 Este equipo, persisted in
  localStorage. Cloud mode adds a one-time access-code form
  (`createCloudSession`).
- `ui/src/components/AgentGate.tsx` (existing, from M2.6) now also covers
  cloud mode's "connecting.../not connected" states with cloud-appropriate
  copy, and a "cambiar modo de trabajo" way back.
- Real app now collapses its sidebar into a hamburger + slide-in drawer
  below 768px (`ui/src/styles.css`), matching the pattern already proven
  for Demo Mode in M2.5B. No horizontal overflow at 320px (tables/diff
  lines shrink, `.main` padding reduces, `body { overflow-x: hidden }`).
- `Project.tsx`/`TaskResult.tsx`: "PROBAR ESTADO ACTUAL"/"PROBAR RESULTADO"
  branch on workspace mode — local mode keeps the existing desktop-process
  preview; cloud mode calls the Web-export endpoints and renders an "ABRIR
  PREVIEW" link instead of polling a process that can't exist on Android.
- Test Game labeling in cloud mode: "PROYECTO REAL DE PRUEBA — CLOUD" with
  the cloud-specific explanatory text from section K.

## 8. Real Cloud E2E (mock executor)

One disposable script run against the real FastAPI app (in-process
`TestClient`, real SQLite, real filesystem, real subprocess Godot calls —
not a permanent pytest file, same methodology as M2.6.1's single real
E2E), with only the AI-executor swapped for `tests/fakes.py`'s
`FakeAIExecutorAdapter` (the validator stays the real, production
`GodotAdapter`):

1. `POST /api/cloud/session` (access code → token) — PASS
2. `GET /api/agent/status` → `mode: "cloud"` — PASS
3. `POST /api/test-game` → real Test Game copy in the Cloud Workspace,
   real `.git` — PASS
4. `POST /api/projects/{id}/webexport/start` (PROBAR ESTADO ACTUAL,
   before any change) → real Godot Web export, correct COOP/COEP headers,
   real `.wasm` served — PASS
5. Task run with objective "Cambia el texto principal a 'Mi primer cambio
   desde el celular'" → real orchestrator, real Git checkpoint, mocked
   Claude step edits `main.tscn` for real, real headless Godot validation
   → `COMPLETED`, `validation_status: pass` — PASS
6. Real change manifest confirms `main.tscn` both claimed and observed by
   Git — PASS
7. `POST /api/task-runs/{id}/webexport/start` (PROBAR RESULTADO) → new,
   different export URL, real updated Web build — PASS
8. `POST /api/task-runs/{id}/rollback` → workspace file verified back to
   the original text on disk (not a phone-side operation) — PASS
9. Path-traversal probe against the live preview route → 404 — PASS

All 9 steps passed on a single run; no retries, no second Claude/mock
invocation needed.

## 9. Tests

- Backend: **143 passed** (full suite, includes new
  `test_cloud_session.py` [7], `test_webexport_router.py` [11], and the
  `docker/Dockerfile.cloud-agent` secret-scan addition to
  `test_build_config_no_secrets.py`). No existing test was deleted or
  weakened to get a PASS.
- Frontend: **32 passed** (26 pre-existing + 6 new in
  `ui/src/api/__tests__/workspaceMode.test.ts` covering mode persistence,
  cloud/local token isolation, and `clearMode`). `npx tsc -b` clean,
  `npx vite build` succeeds.

## 10. Cost

- **Development**: $0. No paid service was contracted or activated. The
  Godot binary/templates are official, free downloads; Docker build/run
  was not exercised in this sandbox (no Docker daemon available) — the
  Dockerfile is written and checksum-verified against real downloads but
  not container-build-verified here.
- **Estimated production**: a single small VM/container host running the
  `docker/Dockerfile.cloud-agent` image (e.g. a $5-10/month 1-2GB
  instance) is sufficient for one user's Cloud Workspace — no managed
  database, queue, or GPU needed. Bandwidth for Web-export previews
  (~10-30MB per export) is the main variable cost at scale.

## 11. Deployment

**REAL APP URL: NOT DEPLOYED.** No cloud compute credentials or
infrastructure were available in this sandbox (no AWS/GCP/Fly.io/Railway
account, no Docker daemon to build+push an image). `docker/Dockerfile.cloud-agent`
is the reproducible artifact for whenever real infrastructure is
provisioned; it needs only `IMPULSOR_HUB_CLOUD_ACCESS_CODE` set at deploy
time (never in the image) and a mounted volume for `IMPULSOR_HUB_DB_PATH`/
project data to persist across restarts.

The existing public **demo** (M2.5B, GitHub Pages,
`https://martincv928-commits.github.io/impulsor-hub/`) was not touched
this milestone and remains a pure frontend simulation — not converted to
Cloud Mode, per section AE. (Not re-curled from this sandbox this session;
this session's egress proxy blocks `*.github.io`, a known limitation
already noted in M2_5B_REPORT.md.)

## 12. Support matrix (section AF)

| | LOCAL | CLOUD |
|---|---|---|
| PC | SUPPORTED (unchanged since M2.6.1) | SUPPORTED (same backend, cloud env var) — not deployed publicly this milestone |
| Android | NOT SUPPORTED (no Android Agent exists or was built) | SUPPORTED (architecture + E2E proven; needs a real deployment to be user-accessible) |

## 13. Limitations

- No real deployment exists yet, so **USER ACCESSIBLE FROM ANDROID: NO**
  today — the architecture, security, and one real E2E are proven, but
  nobody can open a URL from a phone until a host is provisioned (out of
  scope/budget for this milestone; requires the user's explicit go-ahead
  per "no actives servicios de pago sin autorización").
- Real Claude Cloud execution is unverified (legitimately blocked, not
  worked around) — only the orchestrator/Git/Godot/export path around it
  is real-E2E-proven.
- No CORS allowlist changes were made for a cross-origin PC→Cloud setup;
  Android access is same-origin (the Cloud Agent serves its own UI), which
  is the primary use case this milestone targets.
- Single-owner Cloud Workspace only — no multi-user auth/isolation model
  (correctly out of scope per section Y).

## 14. Real Claude consumption

**0** real Claude Code executions this milestone.
