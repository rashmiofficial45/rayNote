import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";

interface ProcessSample {
  pid: number;
  start: number;
  cpuNs: number;
  footprintBytes: number;
  gpuNs: number | null;
}

export interface ResourceSample {
  uptimeNs: number;
  logicalCores: number;
  processes: ProcessSample[];
}

interface Usage {
  ramBytes: number;
  cpu: number | null;
  gpu: number | null;
}

export function measureUsage(sample: ResourceSample, previous?: ResourceSample): Usage {
  const ramBytes = sample.processes.reduce((sum, process) => sum + process.footprintBytes, 0);
  const usage: Usage = { ramBytes, cpu: null, gpu: null };
  if (!previous || sample.uptimeNs <= previous.uptimeNs ||
      sample.processes.length !== previous.processes.length) return usage;

  const elapsed = sample.uptimeNs - previous.uptimeNs;
  let cpuNs = 0;
  let gpuNs = 0;
  let hasGpu = true;
  for (const process of sample.processes) {
    const prior = previous.processes.find(p => p.pid === process.pid && p.start === process.start);
    if (!prior || process.cpuNs < prior.cpuNs) return usage;
    cpuNs += process.cpuNs - prior.cpuNs;
    if (process.gpuNs === null || prior.gpuNs === null || process.gpuNs < prior.gpuNs) {
      hasGpu = false;
    } else {
      gpuNs += process.gpuNs - prior.gpuNs;
    }
  }

  usage.cpu = 100 * cpuNs / elapsed / sample.logicalCores;
  usage.gpu = hasGpu ? 100 * gpuNs / elapsed : null;
  return usage;
}

function useResourceUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let pending = false;
    let previous: ResourceSample | undefined;
    async function poll() {
      if (disposed || pending || document.hidden) return;
      pending = true;
      try {
        const sample = await invoke<ResourceSample>("get_resource_sample");
        if (!disposed && !document.hidden) {
          setUsage(measureUsage(sample, previous));
          previous = sample;
        }
      } catch {
        previous = undefined;
        if (!disposed) setUsage(null);
      } finally {
        pending = false;
      }
    }
    function onVisibilityChange() {
      previous = undefined;
      if (!document.hidden) void poll();
    }
    void poll();
    const timer = window.setInterval(poll, 2000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  return usage;
}

const formatPercent = (value: number | null | undefined) => value == null
  ? "—"
  : value > 0 && value < 0.1 ? "<0.1%" : `${value.toFixed(1)}%`;

export function ResourceUsage({ onDismiss }: { onDismiss?: () => void }) {
  const usage = useResourceUsage();
  const readings = [
    { name: "RAM", value: usage ? `${Math.round(usage.ramBytes / 1_000_000).toLocaleString()} MB` : "—",
      description: "Physical memory footprint" },
    { name: "GPU", value: formatPercent(usage?.gpu), description: usage?.gpu == null
      ? "Waiting for a GPU sample or GPU accounting is unavailable"
      : "GPU execution time relative to the sampling interval" },
    { name: "CPU", value: formatPercent(usage?.cpu), description: "Share of total CPU capacity across all logical cores" },
  ];
  if (onDismiss) {
    return (
      <div className="editor-resource-usage" role="group" aria-label="rayNote resource usage">
        {readings.map(({ name, value, description }) => (
          <span key={name} title={description}>{name} {value}</span>
        ))}
        <button type="button" aria-label="Hide resource usage for this session" onClick={onDismiss}>
          <X size={12} />
        </button>
      </div>
    );
  }
  return (
    <section className="settings-card settings-resources" aria-labelledby="resource-usage-title">
      <h2 id="resource-usage-title">Live resource usage</h2>
      <p>Includes rayNote and the WebKit renderer and GPU processes used by its windows. Refreshes every two seconds.</p>
      <dl>
        {readings.map(({ name, value, description }) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ResourceUsageFooter() {
  const [visible, setVisible] = useState(true);
  if (!visible || !("__TAURI_INTERNALS__" in window)) return null;
  return <ResourceUsage onDismiss={() => setVisible(false)} />;
}
