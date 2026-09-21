-- Impulsor Hub M1 schema
-- SQLite. Kept deliberately simple: one file, additive migrations only.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    root_path   TEXT NOT NULL UNIQUE,
    project_type TEXT NOT NULL DEFAULT 'generic',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS resource (
    id               TEXT PRIMARY KEY,
    adapter_key      TEXT NOT NULL,
    type             TEXT NOT NULL,
    display_name     TEXT NOT NULL,
    version          TEXT,
    availability     TEXT NOT NULL,
    auth_state       TEXT,
    cost_type        TEXT NOT NULL DEFAULT 'unknown',
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    health_json      TEXT NOT NULL DEFAULT '{}',
    checked_at       TEXT
);

CREATE TABLE IF NOT EXISTS task (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    objective   TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_run (
    id                    TEXT PRIMARY KEY,
    task_id               TEXT NOT NULL REFERENCES task(id),
    executor_resource_id  TEXT,
    status                TEXT NOT NULL,
    started_at            TEXT,
    ended_at              TEXT,
    timeout_seconds       INTEGER NOT NULL,
    structured_result_json TEXT,
    stdout_path           TEXT,
    stderr_path           TEXT,
    failure_reason        TEXT,
    disposition           TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS file_change (
    id                  TEXT PRIMARY KEY,
    task_run_id         TEXT NOT NULL REFERENCES task_run(id),
    path                TEXT NOT NULL,
    change_type         TEXT NOT NULL,
    additions           INTEGER,
    deletions           INTEGER,
    claimed_by_executor INTEGER,
    observed_by_vcs     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoint (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES project(id),
    task_run_id    TEXT REFERENCES task_run(id),
    mechanism      TEXT NOT NULL,
    reference      TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    restore_status TEXT NOT NULL DEFAULT 'available'
);

CREATE TABLE IF NOT EXISTS event (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES project(id),
    task_id      TEXT REFERENCES task(id),
    task_run_id  TEXT REFERENCES task_run(id),
    type         TEXT NOT NULL,
    severity     TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL
);

-- Minimal forward-compatible tables (no logic implemented in M1).
CREATE TABLE IF NOT EXISTS approval (
    id          TEXT PRIMARY KEY,
    task_id     TEXT REFERENCES task(id),
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_item (
    id          TEXT PRIMARY KEY,
    project_id  TEXT REFERENCES project(id),
    kind        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_project ON task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_run_task ON task_run(task_id);
CREATE INDEX IF NOT EXISTS idx_file_change_run ON file_change(task_run_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_project ON checkpoint(project_id);
CREATE INDEX IF NOT EXISTS idx_event_project ON event(project_id);
