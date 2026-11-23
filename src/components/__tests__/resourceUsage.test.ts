import { describe, expect, it } from "vitest";
import { measureUsage, type ResourceSample } from "../ResourceUsage";

const baseline: ResourceSample = {
  uptimeNs: 1000,
  logicalCores: 4,
  processes: [
    { pid: 101, start: 5, footprintBytes: 160, cpuNs: 1100, gpuNs: 200 },
    { pid: 102, start: 6, footprintBytes: 320, cpuNs: 500, gpuNs: 300 },
  ],
};

const later: ResourceSample = {
  ...baseline,
  uptimeNs: 2000,
  processes: [
    { ...baseline.processes[0], cpuNs: 1300, gpuNs: 220 },
    { ...baseline.processes[1], cpuNs: 800, gpuNs: 350 },
  ],
};

describe("resource usage", () => {
  it("aggregates physical memory and interval CPU and GPU time", () => {
    expect(measureUsage(later, baseline)).toEqual({ ramBytes: 480, cpu: 12.5, gpu: 7 });
  });

  it("uses a new baseline when a renderer restarts", () => {
    const restarted = { ...later, processes: [{ ...later.processes[0], start: 15 }, later.processes[1]] };
    expect(measureUsage(restarted, baseline)).toEqual({ ramBytes: 480, cpu: null, gpu: null });
  });

  it("distinguishes a missing GPU counter from zero GPU activity", () => {
    expect(measureUsage({ ...later, processes: baseline.processes }, baseline).gpu).toBe(0);
    const missing = { ...later, processes: [{ ...later.processes[0], gpuNs: null }, later.processes[1]] };
    expect(measureUsage(missing, baseline)).toMatchObject({ cpu: 12.5, gpu: null });
  });
});
