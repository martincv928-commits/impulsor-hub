// M2.7 SPEC section Z: LOCAL still works, CLOUD workspace selection
// persists, no secret leaks into the wrong mode's resolved token/base URL.
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeToken,
  apiBaseUrl,
  clearMode,
  getMode,
  hasCloudSession,
  isCloudMode,
  setCloudSession,
  setLocalMode,
} from "../workspaceMode";

beforeEach(() => {
  window.localStorage.clear();
  delete window.__IMPULSOR_AGENT_TOKEN__;
});

describe("workspaceMode", () => {
  it("has no mode chosen by default", () => {
    expect(getMode()).toBeNull();
    expect(isCloudMode()).toBe(false);
    expect(hasCloudSession()).toBe(false);
  });

  it("setLocalMode persists local mode with an empty (same-origin) base URL", () => {
    setLocalMode();
    expect(getMode()).toBe("local");
    expect(isCloudMode()).toBe(false);
    expect(apiBaseUrl()).toBe("");
  });

  it("local mode's activeToken prefers the injected window token", () => {
    setLocalMode();
    window.__IMPULSOR_AGENT_TOKEN__ = "injected-local-token";
    expect(activeToken()).toBe("injected-local-token");
  });

  it("setCloudSession persists mode, url and token together", () => {
    setCloudSession("https://cloud.example.com", "cloud-token-abc");
    expect(getMode()).toBe("cloud");
    expect(isCloudMode()).toBe(true);
    expect(hasCloudSession()).toBe(true);
    expect(apiBaseUrl()).toBe("https://cloud.example.com");
    expect(activeToken()).toBe("cloud-token-abc");
  });

  it("cloud mode never resolves to the local window-injected token, even if both happen to be set", () => {
    setCloudSession("https://cloud.example.com", "cloud-token-abc");
    window.__IMPULSOR_AGENT_TOKEN__ = "should-never-be-used-in-cloud-mode";
    expect(activeToken()).toBe("cloud-token-abc");
  });

  it("clearMode forgets mode, url and token and returns to the unset state", () => {
    setCloudSession("https://cloud.example.com", "cloud-token-abc");
    clearMode();
    expect(getMode()).toBeNull();
    expect(hasCloudSession()).toBe(false);
    expect(apiBaseUrl()).toBe("");
    expect(activeToken()).toBeUndefined();
  });
});
