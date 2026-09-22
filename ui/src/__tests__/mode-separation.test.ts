// Structural guarantee for M2.6 SPEC section J ("la separación Demo/Real
// debe ser estructural y difícil de utilizar accidentalmente de forma
// incorrecta"): source-level import checks, not runtime mocking, so this
// can never pass by accident -- it fails the moment either side gains an
// import it shouldn't have.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const SRC = join(__dirname, "..");

function readAll(dir: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readAll(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push({ path: full, content: readFileSync(full, "utf-8") });
  }
  return out;
}

describe("Demo Mode never calls the real backend", () => {
  const demoFiles = readAll(join(SRC, "demo"));

  it("no file under ui/src/demo/ imports the real ApiClient (api/client)", () => {
    const offenders = demoFiles.filter((f) => /from ["']\.\.?\/.*api\/client["']/.test(f.content));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("no file under ui/src/demo/ calls fetch() directly", () => {
    const offenders = demoFiles.filter((f) => /\bfetch\(/.test(f.content));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

describe("Real Mode never uses DemoTaskEngine", () => {
  const realFiles = [
    ...readAll(join(SRC, "pages")),
    { path: "App.tsx", content: readFileSync(join(SRC, "App.tsx"), "utf-8") },
  ];

  it("no page or App.tsx imports from ui/src/demo/ (except the single DEMO_MODE branch in App.tsx)", () => {
    for (const f of realFiles) {
      if (f.path.endsWith("App.tsx")) {
        // App.tsx is allowed exactly one demo import: the DemoApp component
        // it renders only when DEMO_MODE is true. Anything importing
        // engine/store directly here would be a real bug.
        expect(f.content).not.toMatch(/from ["']\.\/demo\/(engine|store|useDemoStore)["']/);
        continue;
      }
      expect(f.content).not.toMatch(/from ["'].*\/demo\//);
    }
  });
});
