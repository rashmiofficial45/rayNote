import { useEffect, useId, useState } from "react";
import { Layers2 } from "lucide-react";
import { getStoredGlassClarity, setStoredGlassClarity } from "../lib/theme";

export function GlassClaritySlider({ label = "Liquid Glass", description }: {
  label?: string;
  description?: string;
} = {}) {
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
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
        <label htmlFor={inputId}>{!description && <Layers2 size={14} aria-hidden="true" />}{label}</label>
        <span className="glass-clarity-value" aria-hidden="true">{clarity}%</span>
      </div>
      {description && <p id={descriptionId} className="settings-row-desc">{description}</p>}
      <input
        id={inputId}
        type="range"
        className="glass-clarity-slider"
        min={0}
        max={100}
        value={clarity}
        aria-describedby={description ? descriptionId : undefined}
        aria-valuetext={clarity === 0 ? "Solid" : clarity === 100 ? "Super clear" : `${clarity}% clarity`}
        onChange={(event) => setStoredGlassClarity(event.currentTarget.valueAsNumber)}
      />
      <div className="glass-clarity-scale" aria-hidden="true">
        <span>Solid</span><span>Super clear</span>
      </div>
    </div>
  );
}
