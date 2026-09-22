import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pickScenario, runDemoTask, runDemoRollback } from "../engine";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("pickScenario", () => {
  it("picks the direct PASS scenario for a Godot project by default", () => {
    expect(pickScenario("cambia el nombre del personaje", "godot")).toBe("pass");
  });

  it("picks FAIL->repair->PASS when the objective mentions a lives/health system", () => {
    expect(pickScenario("agrega un sistema de vidas al personaje", "godot")).toBe("fail_repair_pass");
    expect(pickScenario("add a health system", "godot")).toBe("fail_repair_pass");
  });

  it("always picks the simple (no-validator) scenario for non-Godot projects, regardless of wording", () => {
    expect(pickScenario("agrega un sistema de vidas", "web")).toBe("simple");
    expect(pickScenario("agrega un sistema de vidas", "other")).toBe("simple");
  });
});

describe("runDemoTask", () => {
  it("PASS scenario: emits a validated result with no error steps", async () => {
    const steps: string[] = [];
    const { promise } = runDemoTask("cambia el nombre del personaje", "godot", (s) => steps.push(s.label));
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.scenario).toBe("pass");
    expect(result.validated).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.filesModified.length).toBeGreaterThan(0);
    expect(result.steps.some((s) => s.status === "error")).toBe(false);
    expect(steps).toContain("Validación superada");
  });

  it("FAIL -> repair -> PASS scenario: fails once, repairs, then passes", async () => {
    const { promise } = runDemoTask("agrega un sistema de vidas al personaje", "godot", () => {});
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.scenario).toBe("fail_repair_pass");
    expect(result.validated).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.filesModified).toEqual(["player.gd", "game_manager.gd"]);

    const failStep = result.steps.find((s) => s.technicalId === "validation.failed");
    expect(failStep?.status).toBe("error");
    expect(failStep?.detail).toContain("Parse error");

    const repairStep = result.steps.find((s) => s.technicalId === "repair.finished");
    expect(repairStep?.status).toBe("success");

    const passSteps = result.steps.filter((s) => s.technicalId === "validation.passed");
    expect(passSteps).toHaveLength(1);
  });

  it("non-Godot project: skips validation entirely (validated is null)", async () => {
    const { promise } = runDemoTask("cambia el texto de la portada", "web", () => {});
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.scenario).toBe("simple");
    expect(result.validated).toBeNull();
    expect(result.steps.some((s) => s.technicalId.startsWith("validation."))).toBe(false);
  });

  it("cancel() stops further step callbacks from firing", async () => {
    const steps: string[] = [];
    const { cancel } = runDemoTask("cambia el nombre del personaje", "godot", (s) => steps.push(s.label));
    await vi.advanceTimersByTimeAsync(300); // only the first step should have fired by now
    cancel();
    await vi.runAllTimersAsync();

    expect(steps.length).toBeLessThanOrEqual(1);
  });
});

describe("runDemoRollback", () => {
  it("emits a restoring step then a restored step", async () => {
    const labels: string[] = [];
    const promise = runDemoRollback((s) => labels.push(s.label));
    await vi.runAllTimersAsync();
    const steps = await promise;

    expect(labels).toEqual(["Restaurando checkpoint...", "Proyecto restaurado"]);
    expect(steps[steps.length - 1].status).toBe("success");
  });
});
