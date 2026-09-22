import { DemoStepEvent } from "../types";

const ICON: Record<DemoStepEvent["status"], string> = { running: "…", success: "✓", error: "✗" };

export default function StepList({ steps }: { steps: DemoStepEvent[] }) {
  return (
    <div className="dm-steps">
      {steps.map((step) => (
        <div className="dm-step" key={step.id}>
          <span className={`dm-step-icon ${step.status}`}>{ICON[step.status]}</span>
          <div>
            <div className="dm-step-label">{step.label}</div>
            {step.detail && <div className="dm-step-detail">{step.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
