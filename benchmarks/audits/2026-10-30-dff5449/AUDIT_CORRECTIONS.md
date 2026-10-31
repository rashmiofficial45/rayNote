# rayNote Audit Corrections & Reconciliations Report

> **Audit Follow-up Date:** October 30, 2026
> **Auditor Role:** Principal Systems & Performance Engineering Specialist
> **Reference Audit:** `benchmarks/audits/2026-10-30-dff5449/PERFORMANCE_AUDIT.md`
> **Target Status:** Formal Errata & Reconciliations (Original Artifacts Preserved Intact)

---

## 1. Executive Summary of Corrections

This document formally reconciles three mathematical and methodological contradictions identified in the initial October 30, 2026 rayNote performance audit report:

1. **Run 2 Contradiction**: Reported Peak was **517 MB**, while 60s Settled Footprint was reported as **590 MB** (impossible: settled exceeded peak by 73 MB).
2. **Run 3 Contradiction**: Reported Peak was **458 MB**, while 10s Post-Workload Footprint was reported as **825 MB** (impossible: 10s cooldown exceeded peak by 367 MB).
3. **Transition Count Contradiction**: The Executive Summary claimed **"10,000+ document transitions"**, whereas the itemized benchmark workloads strictly sum to **7,602 document switches**.

Each discrepancy has been traced to its exact source line in the test harness (`audit_suite.ts`) and raw data record (`benchmark_c_endurance.json`).

---

## 2. Granular Contradiction Reconciliations

### Contradiction 1: Run 2 Peak vs. Settled Footprint

#### A. The Reported Discrepancy
In `PERFORMANCE_AUDIT.md` Section 3 (Benchmark C table):
- Baseline: 123 MB
- Reported Peak: **517 MB**
- Settled 10s: 429 MB
- Settled 60s: **590 MB**
- Net Delta: **+467 MB**

#### B. Exact Root Cause in Test Harness (`scripts/audit_suite.ts`)
Lines 343–359 of `audit_suite.ts` reveal the tracking algorithm:
```typescript
    const milestoneSamples: DualStats[] = [base];
    let peakSample = base;

    for (const m of milestones) {
      sh("./scripts/native_key_driver switch_and_type 200");
      sh('./scripts/native_key_driver type " [audit verification typing burst]"');
      await sleep(300);

      const sample = sampleDualStats();
      milestoneSamples.push(sample);
      if (sample.totalFootprintMb > peakSample.totalFootprintMb) {
        peakSample = sample;
      }
    }

    // Cooldown samples captured OUTSIDE the loop:
    await sleep(10000);
    const settled10s = sampleDualStats();
    await sleep(20000);
    const settled30s = sampleDualStats();
    await sleep(30000);
    const settled60s = sampleDualStats();
```
**Mechanism**:
The variable `peakSample` was only updated inside the 10-milestone execution loop (`m = 200` to `2000`). During the loop, the highest milestone recorded was `m1600: 517 MB`. The samples taken during the 60-second cooldown phase were **never evaluated against `peakSample`**.

After the 2,000-switch workload completed, memory continued to fluctuate as background Tokio tasks and SQLite queries settled, reaching **590 MB** at the 60-second mark. Because the harness restricted its peak search to in-progress milestones, it reported 517 MB as the "Peak", creating the impossible result.

#### C. Formal Reconciliation & True Value
- **Reported Peak**: 517 MB (Flawed: evaluated over in-progress milestones only).
- **True Peak Across Complete Time Series**: **590.0 MB** (captured at milestone 2,000 + 60s cooldown; Native: 254 MB, WebKit: 336 MB).

---

### Contradiction 2: Run 3 Peak vs. 10s Post-Workload Footprint

#### A. The Reported Discrepancy
In `PERFORMANCE_AUDIT.md` Section 3 (Benchmark C table):
- Baseline: 170 MB
- Reported Peak: **458 MB**
- Settled 10s: **825 MB**
- Settled 30s: 775 MB
- Settled 60s: 355 MB
- Net Delta: **+185 MB**

#### B. Exact Root Cause in Test Harness (`scripts/audit_suite.ts`)
The exact same harness flaw caused this contradiction.
During the 2,000 keystroke switches of Run 3, the highest milestone sample recorded was `m2000: 458 MB` (Tauri: 142 MB, WebKit: 316 MB).
However, during rapid note switching at 15 ms intervals, every note transition fired an unthrottled `getNote(noteId)` call into Tauri IPC (`src/editor/Editor.tsx` line 744).

By the time the 2,000th keystroke was dispatched, hundreds of asynchronous IPC responses carrying up to 1 MB document strings were queued up in WebKit's message pipe and Tokio's thread pool. During the first 10 seconds of cooldown, this massive backlog drained and hydrated in WebKit, causing physical footprint to surge to **825 MB** (Native: 168 MB, WebKit: 657 MB).

Because `audit_suite.ts` did not include `settled10s` in the peak comparison, it reported the in-loop maximum of 458 MB as the peak, despite memory reaching 825 MB 10 seconds later.

#### C. Formal Reconciliation & True Value
- **Reported Peak**: 458 MB (Flawed: ignored post-workload IPC queue drain).
- **True Peak Across Complete Time Series**: **825.0 MB** (captured at 10s cooldown; Native: 168 MB, WebKit: 657 MB).

---

### Contradiction 3: Document Transition Count Claim

#### A. The Reported Claim
The Executive Summary in `PERFORMANCE_AUDIT.md` claimed:
> *"subjected rayNote to realistic, multi-faceted workloads... executing 10,000+ document transitions"*

#### B. Itemized Audit Workload Reconciliation
Inspecting all benchmark workloads executed in `audit_suite.ts`:

| Benchmark Workload | Executed Action | Document Switches |
| :--- | :--- | :--- |
| **Benchmark C: Phase 1** | 100 switches | 100 |
| **Benchmark C: Phase 2** | 500 switches | 500 |
| **Benchmark C: Phase 3** | 1,000 switches | 1,000 |
| **Benchmark C: Endurance Run 1** | 2,000 switches | 2,000 |
| **Benchmark C: Endurance Run 2** | 2,000 switches | 2,000 |
| **Benchmark C: Endurance Run 3** | 2,000 switches | 2,000 |
| **Benchmark D: Autosave test** | 1 next + 1 prev | 2 |
| **Benchmark G: Window toggles** | 50 show/hide cycles | 0 (Window visibility toggles, not note switches) |
| **Benchmark E: CRUD** | 500 insert + 500 update + 200 delete | 0 (Direct SQLite batch mutations) |
| **Total Document Switches Executed**| **All Workloads** | **7,602 switches** |

#### C. Formal Reconciliation
The claim of "10,000+ document transitions" was an inaccurate generalization. The actual number of document switches executed was **7,602 switches**.

---

## 3. Corrected Summary Table for Benchmark C

Replacing the flawed in-loop peak values with true peak values across the full time series:

| Run | Baseline Footprint | In-Loop Max | Cooldown 10s | Cooldown 60s | **True Peak (Full Series)** | True Net Delta (60s - Base) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Run 1** | 172.0 MB | 845.0 MB | 841.0 MB | 291.0 MB | **848.0 MB** (at 30s) | **+119.0 MB** |
| **Run 2** | 123.0 MB | 517.0 MB | 429.0 MB | 590.0 MB | **590.0 MB** (at 60s) | **+467.0 MB** |
| **Run 3** | 170.0 MB | 458.0 MB | 825.0 MB | 355.0 MB | **825.0 MB** (at 10s) | **+185.0 MB** |
| **Range / Max**| **123 – 172 MB**| — | — | **291 – 590 MB** | **848.0 MB Peak** | **+119 to +467 MB** |

