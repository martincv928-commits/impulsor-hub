import { DemoProject, DemoTask } from "./types";

// Two pre-existing example projects/tasks shown on first visit, so the
// demo isn't an empty screen. Restablecer Demo restores exactly this.
const iso = (offsetSeconds: number) => new Date(Date.now() - offsetSeconds * 1000).toISOString();

export function seedProjects(): DemoProject[] {
  return [
    { id: "seed-proj-godot", name: "Mi juego (ejemplo)", type: "godot", createdAt: iso(3600), isSeed: true },
    { id: "seed-proj-web", name: "Página web (ejemplo)", type: "web", createdAt: iso(7200), isSeed: true },
  ];
}

export function seedTasks(): DemoTask[] {
  return [
    {
      id: "seed-task-repair",
      projectId: "seed-proj-godot",
      objective: "Agrega un sistema de vidas al personaje",
      scenario: "fail_repair_pass",
      running: false,
      createdAt: iso(600),
      filesModified: ["player.gd", "game_manager.gd"],
      summary:
        "Se agregó un sistema de vidas al personaje y se corrigió automáticamente un error detectado durante la validación.",
      attempts: 2,
      validated: true,
      disposition: "kept",
      rollbackSteps: [],
      steps: [
        { id: "s1", ts: iso(599), label: "Checkpoint creado", status: "success", technicalId: "task.checkpoint_created" },
        { id: "s2", ts: iso(590), label: "Cambios realizados", status: "success", technicalId: "task.execution_finished", detail: "2 archivos modificados" },
        { id: "s3", ts: iso(585), label: "Validación falló", status: "error", technicalId: "validation.failed", detail: "Parse error in player.gd" },
        { id: "s4", ts: iso(580), label: "Reparación aplicada (intento 1)", status: "success", technicalId: "repair.finished" },
        { id: "s5", ts: iso(575), label: "Validación superada", status: "success", technicalId: "validation.passed" },
      ],
    },
  ];
}
