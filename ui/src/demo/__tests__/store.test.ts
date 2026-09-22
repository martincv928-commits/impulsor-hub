import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { demoStore, DemoStore, STORAGE_KEY } from "../store";

beforeEach(() => {
  window.localStorage.clear();
  demoStore.reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("demo mode detection", () => {
  it("stores demo data under its own namespaced localStorage key", () => {
    expect(STORAGE_KEY).toBe("impulsor-hub-demo-v1");
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

describe("seed data", () => {
  it("starts with the two example projects and one example task", () => {
    const state = demoStore.getState();
    expect(state.projects).toHaveLength(2);
    expect(state.projects.map((p) => p.name)).toContain("Mi juego (ejemplo)");
    expect(state.tasks).toHaveLength(1);
  });
});

describe("addProject", () => {
  it("creates a demo project and appends it to state", () => {
    const project = demoStore.addProject("Mi juego de prueba", "godot");
    expect(project.name).toBe("Mi juego de prueba");
    expect(project.type).toBe("godot");
    expect(project.isSeed).toBe(false);
    expect(demoStore.getState().projects).toHaveLength(3);
    expect(demoStore.getProject(project.id)).toEqual(project);
  });
});

describe("startTask (PASS scenario)", () => {
  it("creates a running task, then resolves to a validated task", async () => {
    const project = demoStore.addProject("Proyecto Godot", "godot");
    const task = demoStore.startTask(project.id, "cambia el nombre del personaje");

    expect(task.running).toBe(true);
    expect(demoStore.getTask(task.id)?.running).toBe(true);

    await vi.runAllTimersAsync();

    const finished = demoStore.getTask(task.id);
    expect(finished?.running).toBe(false);
    expect(finished?.validated).toBe(true);
    expect(finished?.scenario).toBe("pass");
  });
});

describe("startTask (FAIL -> repair -> PASS scenario)", () => {
  it("resolves through a failed validation and a repair to a final PASS", async () => {
    const project = demoStore.addProject("Proyecto Godot", "godot");
    const task = demoStore.startTask(project.id, "agrega un sistema de vidas al personaje");

    await vi.runAllTimersAsync();

    const finished = demoStore.getTask(task.id);
    expect(finished?.validated).toBe(true);
    expect(finished?.attempts).toBe(2);
    expect(finished?.steps.some((s) => s.technicalId === "validation.failed")).toBe(true);
    expect(finished?.steps.some((s) => s.technicalId === "repair.finished")).toBe(true);
  });
});

describe("keep", () => {
  it("marks a finished task as kept", async () => {
    const project = demoStore.addProject("Proyecto Godot", "godot");
    const task = demoStore.startTask(project.id, "cambia el nombre del personaje");
    await vi.runAllTimersAsync();

    demoStore.keep(task.id);

    expect(demoStore.getTask(task.id)?.disposition).toBe("kept");
  });
});

describe("rollback", () => {
  it("simulates restoring the checkpoint and marks the task rolled back", async () => {
    const project = demoStore.addProject("Proyecto Godot", "godot");
    const task = demoStore.startTask(project.id, "cambia el nombre del personaje");
    await vi.runAllTimersAsync();

    demoStore.rollback(task.id);
    await vi.runAllTimersAsync();

    const finished = demoStore.getTask(task.id);
    expect(finished?.disposition).toBe("rolled_back");
    expect(finished?.rollbackSteps.length).toBeGreaterThan(0);
    expect(finished?.rollbackSteps[finished!.rollbackSteps.length - 1].status).toBe("success");
  });
});

describe("reset", () => {
  it("wipes user-created projects/tasks and restores the seed data", () => {
    demoStore.addProject("Proyecto temporal", "web");
    expect(demoStore.getState().projects).toHaveLength(3);

    demoStore.reset();

    const state = demoStore.getState();
    expect(state.projects).toHaveLength(2);
    expect(state.projects.some((p) => p.name === "Proyecto temporal")).toBe(false);
  });
});

describe("localStorage persistence", () => {
  it("a fresh DemoStore instance reads back what a previous one saved", () => {
    demoStore.addProject("Proyecto persistente", "other");

    const reloaded = new DemoStore();

    expect(reloaded.getState().projects.some((p) => p.name === "Proyecto persistente")).toBe(true);
  });

  it("markOnboardingSeen persists across a simulated reload", () => {
    expect(demoStore.getState().onboardingSeen).toBe(false);
    demoStore.markOnboardingSeen();

    const reloaded = new DemoStore();

    expect(reloaded.getState().onboardingSeen).toBe(true);
  });

  it("falls back to fresh seed data if localStorage holds garbage", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");
    const store = new DemoStore();
    expect(store.getState().projects).toHaveLength(2);
  });
});
