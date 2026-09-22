// M2.6.1 SPEC section O: EJECUTAR must never start a task doomed to fail
// because Claude Code isn't usable, and the UI must distinguish "not
// installed" from "installed but not authenticated".
import { describe, expect, it } from "vitest";
import { claudeUnavailableReason } from "../pages/NewTask";
import { Resource } from "../api/types";

function resource(overrides: Partial<Resource>): Resource {
  return {
    id: "resource-claude-code",
    adapter_key: "claude_code",
    type: "ai_executor",
    display_name: "Claude Code CLI",
    version: null,
    availability: "available",
    auth_state: null,
    cost_type: "subscription",
    capabilities: [],
    health: {},
    checked_at: null,
    ...overrides,
  };
}

describe("claudeUnavailableReason", () => {
  it("blocks with a clear message when Claude Code is not installed", () => {
    const reason = claudeUnavailableReason([resource({ availability: "unavailable" })]);
    expect(reason).toContain("no está disponible");
  });

  it("blocks with a distinct message when installed but not authenticated", () => {
    const reason = claudeUnavailableReason([resource({ auth_state: "not_authenticated" })]);
    expect(reason).toContain("no autenticado");
  });

  it("does not block when available and authenticated", () => {
    expect(claudeUnavailableReason([resource({ auth_state: "authenticated" })])).toBeNull();
  });

  it("blocks when the claude_code resource is missing entirely", () => {
    expect(claudeUnavailableReason([])).not.toBeNull();
  });
});
