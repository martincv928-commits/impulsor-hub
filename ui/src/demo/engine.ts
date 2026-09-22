// DemoTaskEngine: a pure, frontend-only simulation of the M1/M2 task
// pipeline (checkpoint -> AI executor -> validation -> repair loop ->
// result). No network calls, no filesystem access, no dependency on
// ui/src/api/* -- see ui/src/demo/README.md. This module never touches
// localStorage or React; ui/src/demo/store.ts wires its output into state.
import { DemoProjectType, DemoScenarioId, DemoStepEvent, DemoStepStatus } from "./types";

interface StepDef {
  technicalId: string;
  label: string;
  status: DemoStepStatus;
  detail?: string;
  delayMs: number; // time after the previous step before this one fires
}

export interface DemoTaskResult {
  scenario: DemoScenarioId;
  filesModified: string[];
  summary: string;
  attempts: number;
  validated: boolean | null;
  steps: DemoStepEvent[];
}

const LIFE_SYSTEM_PATTERN = /\bvidas?\b|\blives?\b|\bsalud\b|\bhealth\b/i;

// Deliberately simple: this is a scripted demo, not a real language model.
// Objectives mentioning a "lives/health" system trigger the flagship
// FAIL -> repair -> PASS narrative (mirrors the real, verified Godot 4
// onready/@onready auto-repair scenario from M2 hardening); everything
// else on a Godot project takes the direct PASS path. Non-Godot projects
// have no validator in the real product either, so they skip validation
// entirely, same as M1.
export function pickScenario(objective: string, projectType: DemoProjectType): DemoScenarioId {
  if (projectType !== "godot") return "simple";
  return LIFE_SYSTEM_PATTERN.test(objective) ? "fail_repair_pass" : "pass";
}

function timeline(scenario: DemoScenarioId): { steps: StepDef[]; result: Omit<DemoTaskResult, "steps" | "scenario"> } {
  switch (scenario) {
    case "simple":
      return {
        steps: [
          { technicalId: "task.checkpoint_created", label: "Creando checkpoint...", status: "running", delayMs: 300 },
          { technicalId: "task.checkpoint_created", label: "Checkpoint creado", status: "success", delayMs: 500 },
          { technicalId: "task.execution_started", label: "Claude Code trabajando...", status: "running", delayMs: 400 },
          {
            technicalId: "task.execution_finished",
            label: "Cambios realizados",
            status: "success",
            detail: "1 archivo modificado",
            delayMs: 1200,
          },
        ],
        result: {
          filesModified: ["index.html"],
          summary: "Se aplicó el cambio solicitado. Este proyecto no usa un validador automático (no es un proyecto Godot).",
          attempts: 1,
          validated: null,
        },
      };
    case "pass":
      return {
        steps: [
          { technicalId: "task.checkpoint_created", label: "Creando checkpoint...", status: "running", delayMs: 300 },
          { technicalId: "task.checkpoint_created", label: "Checkpoint creado", status: "success", delayMs: 500 },
          { technicalId: "task.execution_started", label: "Claude Code trabajando...", status: "running", delayMs: 400 },
          {
            technicalId: "task.execution_finished",
            label: "Cambios realizados",
            status: "success",
            detail: "2 archivos modificados",
            delayMs: 1300,
          },
          { technicalId: "validation.started", label: "Validando con Godot...", status: "running", delayMs: 400 },
          {
            technicalId: "validation.passed",
            label: "Validación superada",
            status: "success",
            delayMs: 1100,
          },
        ],
        result: {
          filesModified: ["character.gd", "character_data.tres"],
          summary: "Se realizó el cambio solicitado en el personaje. La validación con Godot fue exitosa en el primer intento.",
          attempts: 1,
          validated: true,
        },
      };
    case "fail_repair_pass":
      return {
        steps: [
          { technicalId: "task.checkpoint_created", label: "Creando checkpoint...", status: "running", delayMs: 300 },
          { technicalId: "task.checkpoint_created", label: "Checkpoint creado", status: "success", delayMs: 500 },
          { technicalId: "task.execution_started", label: "Claude Code trabajando...", status: "running", delayMs: 400 },
          {
            technicalId: "task.execution_finished",
            label: "Cambios realizados",
            status: "success",
            detail: "2 archivos modificados",
            delayMs: 1300,
          },
          { technicalId: "validation.started", label: "Validando con Godot...", status: "running", delayMs: 400 },
          {
            technicalId: "validation.failed",
            label: "Validación falló",
            status: "error",
            detail: "Parse error in player.gd",
            delayMs: 1100,
          },
          {
            technicalId: "repair.started",
            label: "Intentando reparación automática...",
            status: "running",
            delayMs: 700,
          },
          {
            technicalId: "repair.finished",
            label: "Reparación aplicada (intento 1)",
            status: "success",
            delayMs: 1300,
          },
          { technicalId: "validation.started", label: "Validando con Godot...", status: "running", delayMs: 400 },
          {
            technicalId: "validation.passed",
            label: "Validación superada",
            status: "success",
            delayMs: 1100,
          },
        ],
        result: {
          filesModified: ["player.gd", "game_manager.gd"],
          summary:
            "Se agregó un sistema de vidas al personaje y se corrigió automáticamente un error detectado durante la validación.",
          attempts: 2,
          validated: true,
        },
      };
  }
}

/** Fire `onStep` for each step in the scenario timeline, then resolve with the final result. Cancel with the returned function. */
export function runDemoTask(
  objective: string,
  projectType: DemoProjectType,
  onStep: (step: DemoStepEvent) => void
): { promise: Promise<DemoTaskResult>; cancel: () => void } {
  const scenario = pickScenario(objective, projectType);
  const { steps, result } = timeline(scenario);
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  const promise = new Promise<DemoTaskResult>((resolve) => {
    let elapsed = 0;
    const collected: DemoStepEvent[] = [];
    steps.forEach((def, idx) => {
      elapsed += def.delayMs;
      const timer = setTimeout(() => {
        if (cancelled) return;
        const step: DemoStepEvent = {
          id: `${def.technicalId}-${idx}`,
          ts: new Date().toISOString(),
          label: def.label,
          status: def.status,
          technicalId: def.technicalId,
          detail: def.detail,
        };
        collected.push(step);
        onStep(step);
        if (idx === steps.length - 1) {
          resolve({ scenario, steps: collected, ...result });
        }
      }, elapsed);
      timers.push(timer);
    });
  });

  return { promise, cancel: () => { cancelled = true; timers.forEach(clearTimeout); } };
}

export function runDemoRollback(onStep: (step: DemoStepEvent) => void): Promise<DemoStepEvent[]> {
  const steps: StepDef[] = [
    { technicalId: "rollback.started", label: "Restaurando checkpoint...", status: "running", delayMs: 300 },
    { technicalId: "rollback.finished", label: "Proyecto restaurado", status: "success", delayMs: 900 },
  ];
  return new Promise((resolve) => {
    let elapsed = 0;
    const collected: DemoStepEvent[] = [];
    steps.forEach((def, idx) => {
      elapsed += def.delayMs;
      setTimeout(() => {
        const step: DemoStepEvent = {
          id: `${def.technicalId}-${idx}`,
          ts: new Date().toISOString(),
          label: def.label,
          status: def.status,
          technicalId: def.technicalId,
        };
        collected.push(step);
        onStep(step);
        if (idx === steps.length - 1) resolve(collected);
      }, elapsed);
    });
  });
}
