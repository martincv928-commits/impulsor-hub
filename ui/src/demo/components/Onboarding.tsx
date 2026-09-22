import { demoStore } from "../store";

const STEPS = [
  { n: 1, text: "Agrega un proyecto" },
  { n: 2, text: "Describe lo que quieres" },
  { n: 3, text: "Impulsor Hub elige y coordina recursos" },
  { n: 4, text: "Las herramientas verifican el resultado" },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <div className="dm-onboarding">
      <h1>Impulsor Hub</h1>
      <p className="dm-tagline">Haz que tus IAs y herramientas trabajen juntas.</p>
      {STEPS.map((s) => (
        <div className="dm-onboarding-step" key={s.n}>
          <div className="dm-onboarding-num">{s.n}</div>
          <p>{s.text}</p>
        </div>
      ))}
      <div className="dm-onboarding-cta">
        <button
          className="dm-btn primary"
          onClick={() => {
            demoStore.markOnboardingSeen();
            onDone();
          }}
        >
          PROBAR DEMO
        </button>
      </div>
    </div>
  );
}
