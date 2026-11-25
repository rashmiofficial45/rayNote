import { useEffect, useId, useState } from "react";
import { Layers2 } from "lucide-react";
import { getStoredGlassClarity, setStoredGlassClarity } from "../lib/theme";

export function GlassClaritySlider() {
  const inputId = useId();
  const [clarity, setClarity] = useState(() =>
    Number(document.documentElement.dataset.glassClarity ?? getStoredGlassClarity()),
  );

  useEffect(() => {
    const onClarityChange = (event: Event) => {
      setClarity((event as CustomEvent<number>).detail);
    };
    window.addEventListener("raynote:glass-clarity", onClarityChange);
    return () => window.removeEventListener("raynote:glass-clarity", onClarityChange);
  }, []);

  return (
    <div className="glass-clarity-control">
      <div className="glass-clarity-header">
        <label htmlFor={inputId}><Layers2 size={14} aria-hidden="true" /> Liquid Glass</label>
        <span className="glass-clarity-value" aria-hidden="true">{clarity}%</span>
      </div>
      <input
        id={inputId}
        type="range"
        className="glass-clarity-slider"
        min={0}
        max={100}
        value={clarity}
        aria-valuetext={clarity === 0 ? "Solid" : clarity === 100 ? "Super clear" : `${clarity}% clarity`}
        onChange={(event) => setStoredGlassClarity(event.currentTarget.valueAsNumber)}
      />
      <div className="glass-clarity-scale" aria-hidden="true">
        <span>Solid</span><span>Super clear</span>
      </div>
    </div>
  );
}
