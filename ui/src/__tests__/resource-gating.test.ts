// M2.6.1 SPEC section O: EJECUTAR must never start a task doomed to fail
// because the active AI provider isn't usable, and the UI must
// distinguish "not installed" from "installed but not authenticated".
// M2.8: generalized from a claude_code-only check to whichever provider
// is currently active (app/core/router/router.py's selectable registry),
// since the Hub is no longer dependent on a single AI vendor.
import { describe, expect, it } from "vitest";
import { activeProviderUnavailableReason } from "../pages/NewTask";
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

describe("activeProviderUnavailableReason", () => {
  it("blocks with a clear message when the active provider is not installed", () => {
    const reason = activeProviderUnavailableReason([resource({ availability: "unavailable" })], "claude_code");
    expect(reason).toContain("no está disponible");
  });

  it("blocks with a distinct message when installed but not authenticated", () => {
    const reason = activeProviderUnavailableReason([resource({ auth_state: "not_authenticated" })], "claude_code");
    expect(reason).toContain("no autenticado");
  });

  it("does not block when the active provider is available and authenticated", () => {
    expect(
      activeProviderUnavailableReason([resource({ auth_state: "authenticated" })], "claude_code")
    ).toBeNull();
  });

  it("blocks when the active provider's resource is missing entirely", () => {
    expect(activeProviderUnavailableReason([], "claude_code")).not.toBeNull();
  });

  it("gates on codex when codex is the active provider, ignoring an unrelated authenticated claude_code row", () => {
    const resources = [
      resource({ auth_state: "authenticated" }),
      resource({
        id: "resource-codex",
        adapter_key: "codex",
        display_name: "Codex CLI",
        auth_state: "not_authenticated",
      }),
    ];
    const reason = activeProviderUnavailableReason(resources, "codex");
    expect(reason).toContain("Codex CLI");
    expect(reason).toContain("no autenticado");
  });

  it("does not block when gemini is active and authenticated", () => {
    const resources = [
      resource({
        id: "resource-gemini",
        adapter_key: "gemini",
        display_name: "Gemini CLI",
        auth_state: "authenticated",
      }),
    ];
    expect(activeProviderUnavailableReason(resources, "gemini")).toBeNull();
  });
});
