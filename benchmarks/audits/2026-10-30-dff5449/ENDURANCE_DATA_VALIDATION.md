# rayNote Endurance Data & Process Accounting Validation

> **Audit Follow-up Date:** October 30, 2026
> **Auditor Role:** Principal Systems & Performance Engineering Specialist
> **Subject Data:** `benchmarks/audits/2026-10-30-dff5449/raw/benchmark_c_endurance.json`

---

## 1. Process Set & PID Integrity Across Endurance Runs

For every endurance run in Benchmark C, process identities were verified at every sampling point:

| Run Number | Native Host (`raynote`) PID | WebKit (`WebContent`) PID | Process Restarts Observed | PID Stability |
| :--- | :--- | :--- | :--- | :--- |
| **Run 1** | `53949` | `53954` | 0 (None) | **100% Constant** across all 14 samples |
| **Run 2** | `54928` | `54932` | 0 (None) | **100% Constant** across all 14 samples |
| **Run 3** | `55900` | `55904` | 0 (None) | **100% Constant** across all 14 samples |

- **Verification**: At no point during an endurance run did either process crash, respawn, or change PID.
- **Process Accounting Isolation**: Native Rust and WebKit WebContent processes were sampled independently using `/bin/ps` and `/usr/bin/footprint` targeted strictly by PID.

---

## 2. Memory Metric Taxonomy & Additive Validity

| Metric Name | macOS Subsystem | Additive Across Processes? | Description & Architectural Significance |
| :--- | :--- | :--- | :--- |
| **Physical Footprint (`footprint`)** | Mach VM Kernel | **YES (Primary Metric)** | Canonical dirty anonymous memory physically backed by RAM or active compressed swap. Unevictable by the OS. |
| **Resident Set Size (RSS, `ps -o rss`)** | Mach Task Info | **NO (Non-Additive)** | Total virtual pages mapped in the page table. Includes clean shared dyld caches and frameworks (`__TEXT`, `__OBJC_RO`). Summing RSS across processes double-counts shared memory. |
| **Private Dirty Memory (`vmmap`)** | Malloc Subsystem | **YES** | Dirty heap and stack memory exclusively owned by the target process. |
| **Compressed / Swapped Memory** | macOS VM Compressor | **YES** | Anonymous dirty pages compressed by the kernel. Counted directly into Physical Footprint on macOS. |

---

## 3. Sample Inventory & Completeness Audit

Each 2,000-switch endurance run in `benchmark_c_endurance.json` was audited for temporal completeness:

| Workload Milestone | Target Action | Timestamp Recorded | PIDs Recorded | Tauri Stats | WebKit Stats | Total Footprint |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Milestone 0** | Clean baseline | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 200** | 200 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 400** | 400 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 600** | 600 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 800** | 800 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 1000** | 1,000 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 1200** | 1,200 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 1400** | 1,400 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 1600** | 1,600 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 1800** | 1,800 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Milestone 2000** | 2,000 switches + type | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Cooldown 10s** | 10s idle settlement | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Cooldown 30s** | 30s idle settlement | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |
| **Cooldown 60s** | 60s idle settlement | Yes (ISO 8601) | Yes (Dual) | RSS, Footprint, CPU, Th | RSS, Footprint, CPU, Th | Yes (Calculated) |

---

## 4. Chart Generation Discrepancy Analysis

Inspecting `scripts/generate_charts.ts`:
```typescript
function generateEnduranceChart() {
  const data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'benchmark_c_endurance.json'), 'utf8'));
  const milestones = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000];

  const getPoints = (runIdx: number) => {
    const run = data.enduranceRuns[runIdx];
    return run.milestones.map((m: any, i: number) => {
      const x = 80 + (i / 10) * 560;
      const y = 300 - (m.totalFootprintMb / 900) * 240;
      return `${x},${y}`;
    }).join(' ');
  };
```

### Critical Findings:
1. **Truncated Visualization**: The chart `charts/endurance_memory.svg` plotted **only the 11 in-workload milestones**, ending at operation 2,000.
2. **Omission of Cooldown Dynamics**: The chart completely truncated the 60-second cooldown period, hiding:
   - The **825 MB post-workload surge** in Run 3 at 10s.
   - The **590 MB delayed retention** in Run 2 at 60s.
   - The **291 MB reclamation** in Run 1 at 60s.
3. **Flawed Legend**: The SVG legend printed `Peak: 458 MB` for Run 3 and `Peak: 517 MB` for Run 2, directly reflecting the flawed harness peak variable.

---

## 5. Conclusion & Corrective Requirements

1. **Measurement Integrity**: Raw data collection was physically accurate and uncorrupted; PIDs remained constant and process accounting was consistent.
2. **Analysis Flaw**: The test harness algorithm contained a logical error where `peakSample` was scoped only to in-workload milestones, omitting the cooldown phase.
3. **Action Taken**: The reproduction runner `scripts/reproduce_endurance.ts` corrects this by tracking peak across all 14 time series points and outputting the full dataset.

