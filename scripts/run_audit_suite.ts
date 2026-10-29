/// <reference types="node" />
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: unknown) {
    const error = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return (error.stdout || error.stderr || "").toString().trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ProcessMetrics {
  pid: number;
  role: "Tauri-Native" | "WebKit-WebContent";
  rssMb: number;
  physFootprintMb: number;
  peakFootprintMb: number;
  dirtyMb: number;
  cpuPct: number;
  threads: number;
}

export interface CombinedMetrics {
  timestamp: string;
  workload: string;
  repetition: number;
  operationCount: number;
  tauri: ProcessMetrics;
  webKit: ProcessMetrics;
  totalFootprintMb: number;
  totalRssMb: number;
  phase: "baseline" | "in-progress" | "peak" | "immediate-post" | "cooldown-1m" | "cooldown-settled";
}

const csvHeader = [
  "timestamp",
  "workload",
  "repetition",
  "operation_count",
  "phase",
  "process_role",
  "pid",
  "rss_mb",
  "phys_footprint_mb",
  "peak_footprint_mb",
  "dirty_mb",
  "cpu_pct",
  "threads",
  "total_app_footprint_mb",
].join(",");

const csvFilePath = path.resolve(process.cwd(), "MEMORY_BENCHMARK_RESULTS.csv");

function appendToCsv(metric: CombinedMetrics): void {
  const row1 = [
    metric.timestamp,
    `"${metric.workload}"`,
    metric.repetition,
    metric.operationCount,
    metric.phase,
    metric.tauri.role,
    metric.tauri.pid,
    metric.tauri.rssMb.toFixed(2),
    metric.tauri.physFootprintMb.toFixed(2),
    metric.tauri.peakFootprintMb.toFixed(2),
    metric.tauri.dirtyMb.toFixed(2),
    metric.tauri.cpuPct.toFixed(1),
    metric.tauri.threads,
    metric.totalFootprintMb.toFixed(2),
  ].join(",");

  const row2 = [
    metric.timestamp,
    `"${metric.workload}"`,
    metric.repetition,
    metric.operationCount,
    metric.phase,
    metric.webKit.role,
    metric.webKit.pid,
    metric.webKit.rssMb.toFixed(2),
    metric.webKit.physFootprintMb.toFixed(2),
    metric.webKit.peakFootprintMb.toFixed(2),
    metric.webKit.dirtyMb.toFixed(2),
    metric.webKit.cpuPct.toFixed(1),
    metric.webKit.threads,
    metric.totalFootprintMb.toFixed(2),
  ].join(",");

  fs.appendFileSync(csvFilePath, row1 + "\n" + row2 + "\n", "utf8");
}

let globalTauriPid: number | null = null;
let globalWebKitPid: number | null = null;

async function launchAndDiscoverPids(): Promise<{ tauriPid: number; webKitPid: number }> {
  sh("pkill -f raynote || true");
  await sleep(1500);

  const beforePids = new Set(
    sh("pgrep -f com.apple.WebKit.WebContent")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  sh("open /Applications/rayNote.app");

  let tauriPid: number | null = null;
  let webKitPid: number | null = null;

  for (let attempt = 0; attempt < 35; attempt++) {
    await sleep(350);
    if (!tauriPid) {
      const tauriOut = sh("pgrep -f 'rayNote.app/Contents/MacOS/raynote'");
      const p = parseInt(tauriOut.split("\n")[0] || "", 10);
      if (p) tauriPid = p;
    }

    if (!webKitPid) {
      const currentPids = sh("pgrep -f com.apple.WebKit.WebContent")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const diff = currentPids.find((p) => !beforePids.has(p));
      if (diff) {
        webKitPid = parseInt(diff, 10);
      }
    }

    if (tauriPid && webKitPid) {
      globalTauriPid = tauriPid;
      globalWebKitPid = webKitPid;
      return { tauriPid, webKitPid };
    }
  }

  throw new Error(`Failed to discover rayNote processes (tauri: ${tauriPid}, webkit: ${webKitPid})`);
}

function measureProcess(pid: number, role: "Tauri-Native" | "WebKit-WebContent"): ProcessMetrics {
  // 1. Footprint
  const fpOut = sh(`footprint ${pid} 2>/dev/null`);
  let physFootprintMb = 0;
  let peakFootprintMb = 0;
  let dirtyMb = 0;

  const fpMatch = fpOut.match(/Footprint:\s*(\d+)\s*MB/i);
  if (fpMatch) physFootprintMb = parseInt(fpMatch[1], 10);

  const peakMatch = fpOut.match(/phys_footprint_peak:\s*(\d+)\s*MB/i);
  if (peakMatch) peakFootprintMb = parseInt(peakMatch[1], 10);

  const dirtyMatch = fpOut.match(/TOTAL\s*\n\s*(\d+)\s*MB/i);
  if (dirtyMatch) dirtyMb = parseInt(dirtyMatch[1], 10);

  // 2. RSS via ps
  const rssKbStr = sh(`ps -o rss= -p ${pid} 2>/dev/null`);
  const rssMb = (parseFloat(rssKbStr) || 0) / 1024.0;

  // 3. CPU and Threads via top
  const topOut = sh(`top -l 1 -stats pid,cpu,th -pid ${pid} 2>/dev/null | tail -n 1`);
  const topParts = topOut.trim().split(/\s+/);
  let cpuPct = 0;
  let threads = 0;
  if (topParts.length >= 3) {
    cpuPct = parseFloat(topParts[1]) || 0;
    threads = parseInt(topParts[2], 10) || 0;
  }

  return {
    pid,
    role,
    rssMb,
    physFootprintMb,
    peakFootprintMb,
    dirtyMb,
    cpuPct,
    threads,
  };
}

function sample(
  workload: string,
  repetition: number,
  operationCount: number,
  phase: CombinedMetrics["phase"]
): CombinedMetrics {
  if (!globalTauriPid || !globalWebKitPid) {
    throw new Error("PIDs not initialized");
  }

  const tauri = measureProcess(globalTauriPid, "Tauri-Native");
  const webKit = measureProcess(globalWebKitPid, "WebKit-WebContent");
  const totalFootprintMb = tauri.physFootprintMb + webKit.physFootprintMb;
  const totalRssMb = tauri.rssMb + webKit.rssMb;

  const metric: CombinedMetrics = {
    timestamp: new Date().toISOString(),
    workload,
    repetition,
    operationCount,
    tauri,
    webKit,
    totalFootprintMb,
    totalRssMb,
    phase,
  };

  appendToCsv(metric);
  return metric;
}

function keyNextNote(): void {
  sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to key code 125 using {option down}'");
}

function keyPrevNote(): void {
  sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to key code 126 using {option down}'");
}

function keyNewNote(): void {
  sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to keystroke \"n\" using {command down}'");
}

function keyCommandPalette(): void {
  sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to keystroke \"k\" using {command down}'");
}

function keySmartSearch(): void {
  sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to keystroke \"p\" using {command down}'");
}

function keyEscape(): void {
  sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to key code 53'");
}

function keyTypeString(str: string): void {
  sh(`osascript -e 'tell application "System Events" to tell process "raynote" to keystroke "${str}"'`);
}

function keyUndo(): void {
  sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to keystroke \"z\" using {command down}'");
}

function keyRedo(): void {
  sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to keystroke \"z\" using {command down, shift down}'");
}

export async function runComprehensiveAudit(): Promise<void> {
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("🔎 rayNote Comprehensive Memory Leak Audit & Verification Suite");
  console.log("══════════════════════════════════════════════════════════════════\n");

  fs.writeFileSync(csvFilePath, csvHeader + "\n", "utf8");

  // =========================================================================
  // TEST A: Fresh-Launch Baseline & Idle Settlement (3 independent reps)
  // =========================================================================
  console.log("▶ [Test A] Fresh-Launch Baseline & Idle Settlement (3 Repetitions)...");
  for (let rep = 1; rep <= 3; rep++) {
    console.log(`  • Repetition ${rep}/3: Launching clean process...`);
    const { tauriPid, webKitPid } = await launchAndDiscoverPids();
    sh("osascript -e 'tell application \"System Events\" to tell process \"raynote\" to set frontmost to true'");
    await sleep(2000);

    const m0 = sample("Test A - Fresh Baseline", rep, 0, "baseline");
    console.log(`    - Boot Footprint: ${m0.totalFootprintMb.toFixed(1)} MB (Native PID ${tauriPid}: ${m0.tauri.physFootprintMb} MB, WebKit PID ${webKitPid}: ${m0.webKit.physFootprintMb} MB, CPU: ${m0.webKit.cpuPct.toFixed(1)}%)`);

    // Settle for 10 seconds
    await sleep(10000);
    const mSettle = sample("Test A - Fresh Baseline", rep, 0, "cooldown-settled");
    console.log(`    - Settled Footprint: ${mSettle.totalFootprintMb.toFixed(1)} MB (Native: ${mSettle.tauri.physFootprintMb} MB, WebKit: ${mSettle.webKit.physFootprintMb} MB, CPU: ${mSettle.webKit.cpuPct.toFixed(1)}%)`);
  }

  // =========================================================================
  // TEST B: Standard Note Switching (200 switches, repeated with 1,000 switches, 3 reps)
  // =========================================================================
  console.log("\n▶ [Test B] Standard Note Switching (200 switches & 1,000 switches, 3 Reps)...");
  for (let rep = 1; rep <= 3; rep++) {
    console.log(`  • Repetition ${rep}/3:`);
    const base = sample("Test B - Standard Switching", rep, 0, "baseline");

    // Phase B1: 200 switches
    console.log(`    - Executing 200 alternating note switches...`);
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) keyNextNote();
      else keyPrevNote();
      await sleep(20);
    }
    const m200 = sample("Test B - Standard Switching", rep, 200, "in-progress");
    console.log(`      Post-200 Footprint: ${m200.totalFootprintMb.toFixed(1)} MB (WebKit: ${m200.webKit.physFootprintMb} MB)`);

    // Phase B2: 800 additional switches (total 1,000)
    console.log(`    - Executing 800 additional note switches (reaching 1,000)...`);
    for (let i = 200; i < 1000; i++) {
      if (i % 2 === 0) keyNextNote();
      else keyPrevNote();
      await sleep(15);
      if ((i + 1) % 250 === 0) {
        sample("Test B - Standard Switching", rep, i + 1, "in-progress");
      }
    }
    const m1000Peak = sample("Test B - Standard Switching", rep, 1000, "peak");
    console.log(`      Peak-1000 Footprint: ${m1000Peak.totalFootprintMb.toFixed(1)} MB (WebKit: ${m1000Peak.webKit.physFootprintMb} MB)`);

    console.log(`    - Waiting 8s for WebKit GC & idle rest...`);
    await sleep(8000);
    const m1000Settled = sample("Test B - Standard Switching", rep, 1000, "cooldown-settled");
    const delta = m1000Settled.totalFootprintMb - base.totalFootprintMb;
    console.log(`      Settled-1000 Footprint: ${m1000Settled.totalFootprintMb.toFixed(1)} MB (Delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} MB, CPU: ${m1000Settled.webKit.cpuPct.toFixed(1)}%)`);
  }

  // =========================================================================
  // TEST C: Large-Document Switching (100 KB, 500 KB, 1 MB documents)
  // =========================================================================
  console.log("\n▶ [Test C] Large-Document Switching (100 KB, 500 KB, 1 MB notes)...");
  for (let rep = 1; rep <= 3; rep++) {
    console.log(`  • Repetition ${rep}/3:`);
    const base = sample("Test C - Large Document Switching", rep, 0, "baseline");

    console.log(`    - Cycling 100 switches across multi-megabyte isolation fixtures...`);
    for (let i = 0; i < 100; i++) {
      keyNextNote();
      await sleep(35); // Allow ProseMirror hydration of large documents
    }
    const peak = sample("Test C - Large Document Switching", rep, 100, "peak");
    console.log(`      Peak Footprint: ${peak.totalFootprintMb.toFixed(1)} MB (WebKit: ${peak.webKit.physFootprintMb} MB)`);

    console.log(`    - Waiting 8s for WebKit GC & memory stabilization...`);
    await sleep(8000);
    const settled = sample("Test C - Large Document Switching", rep, 100, "cooldown-settled");
    const delta = settled.totalFootprintMb - base.totalFootprintMb;
    console.log(`      Settled Footprint: ${settled.totalFootprintMb.toFixed(1)} MB (Delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} MB, CPU: ${settled.webKit.cpuPct.toFixed(1)}%)`);
  }

  // =========================================================================
  // TEST D: Editing, Keystrokes & Undo/Redo Cycling
  // =========================================================================
  console.log("\n▶ [Test D] Rapid Editing, Autosave & Undo/Redo Cycles (3 Repetitions)...");
  for (let rep = 1; rep <= 3; rep++) {
    console.log(`  • Repetition ${rep}/3:`);
    const base = sample("Test D - Editing & Undo/Redo", rep, 0, "baseline");

    console.log(`    - Injecting 50 bursts of text and undo/redo operations...`);
    for (let i = 0; i < 50; i++) {
      keyTypeString(" The quick brown fox jumps over the lazy dog.");
      await sleep(30);
      keyUndo();
      await sleep(20);
      keyRedo();
      await sleep(20);
    }
    const peak = sample("Test D - Editing & Undo/Redo", rep, 50, "peak");
    console.log(`      Peak Footprint: ${peak.totalFootprintMb.toFixed(1)} MB (WebKit: ${peak.webKit.physFootprintMb} MB)`);

    console.log(`    - Waiting 6s for autosave flush and GC...`);
    await sleep(6000);
    const settled = sample("Test D - Editing & Undo/Redo", rep, 50, "cooldown-settled");
    const delta = settled.totalFootprintMb - base.totalFootprintMb;
    console.log(`      Settled Footprint: ${settled.totalFootprintMb.toFixed(1)} MB (Delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} MB, CPU: ${settled.webKit.cpuPct.toFixed(1)}%)`);
  }

  // =========================================================================
  // TEST E: Search & Navigation Stress (⌘P Smart Search, ⌘K Palette)
  // =========================================================================
  console.log("\n▶ [Test E] Search & Navigation Stress (3 Repetitions)...");
  for (let rep = 1; rep <= 3; rep++) {
    console.log(`  • Repetition ${rep}/3:`);
    const base = sample("Test E - Search & Navigation", rep, 0, "baseline");

    console.log(`    - Triggering 40 rapid query search and palette cycles...`);
    const queries = ["architecture", "performance", "sqlite", "note", "benchmark", "prosemirror", "xyznotfound"];
    for (let i = 0; i < 40; i++) {
      keySmartSearch();
      await sleep(50);
      keyTypeString(queries[i % queries.length]);
      await sleep(60);
      keyEscape();
      await sleep(40);
    }
    const peak = sample("Test E - Search & Navigation", rep, 40, "peak");
    console.log(`      Peak Footprint: ${peak.totalFootprintMb.toFixed(1)} MB (WebKit: ${peak.webKit.physFootprintMb} MB)`);

    console.log(`    - Waiting 5s for search index cache settlement...`);
    await sleep(5000);
    const settled = sample("Test E - Search & Navigation", rep, 40, "cooldown-settled");
    const delta = settled.totalFootprintMb - base.totalFootprintMb;
    console.log(`      Settled Footprint: ${settled.totalFootprintMb.toFixed(1)} MB (Delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} MB, CPU: ${settled.webKit.cpuPct.toFixed(1)}%)`);
  }

  // =========================================================================
  // TEST F: Lifecycle & Cleanup (Create, Duplicate, Pin, Delete, Modals)
  // =========================================================================
  console.log("\n▶ [Test F] Lifecycle Operations (Create, Duplicate, Pin, Modals)...");
  for (let rep = 1; rep <= 3; rep++) {
    console.log(`  • Repetition ${rep}/3:`);
    const base = sample("Test F - Lifecycle Operations", rep, 0, "baseline");

    console.log(`    - Creating and switching across 25 dynamic notes...`);
    for (let i = 0; i < 25; i++) {
      keyNewNote();
      await sleep(100);
      keyTypeString(`Lifecycle Test Note ${rep}-${i}`);
      await sleep(50);
      keyEscape();
      await sleep(50);
    }
    const peak = sample("Test F - Lifecycle Operations", rep, 25, "peak");
    console.log(`      Peak Footprint: ${peak.totalFootprintMb.toFixed(1)} MB (WebKit: ${peak.webKit.physFootprintMb} MB)`);

    console.log(`    - Waiting 6s for note creation persistence and GC...`);
    await sleep(6000);
    const settled = sample("Test F - Lifecycle Operations", rep, 25, "cooldown-settled");
    const delta = settled.totalFootprintMb - base.totalFootprintMb;
    console.log(`      Settled Footprint: ${settled.totalFootprintMb.toFixed(1)} MB (Delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} MB, CPU: ${settled.webKit.cpuPct.toFixed(1)}%)`);
  }

  // =========================================================================
  // TEST G: High-Volume Long-Duration Endurance (2,000 Switches + Interleaved Editing)
  // =========================================================================
  console.log("\n▶ [Test G] High-Volume Long-Duration Endurance (2,000 Switches & Editing)...");
  const enduranceBase = sample("Test G - Long-Duration Endurance", 1, 0, "baseline");
  console.log(`  • Baseline: ${enduranceBase.totalFootprintMb.toFixed(1)} MB`);

  for (let i = 1; i <= 2000; i++) {
    if (i % 2 === 0) keyNextNote();
    else keyPrevNote();
    await sleep(12);

    if (i % 200 === 0) {
      keyTypeString(" Periodic endurance edit.");
      await sleep(40);
      const m = sample("Test G - Long-Duration Endurance", 1, i, "in-progress");
      console.log(`    - Milestone ${i}/2000 switches: Total ${m.totalFootprintMb.toFixed(1)} MB (WebKit: ${m.webKit.physFootprintMb} MB, CPU: ${m.webKit.cpuPct.toFixed(1)}%)`);
    }
  }

  const endurancePeak = sample("Test G - Long-Duration Endurance", 1, 2000, "peak");
  console.log(`  • Peak Total Footprint: ${endurancePeak.totalFootprintMb.toFixed(1)} MB (WebKit: ${endurancePeak.webKit.physFootprintMb} MB)`);

  console.log(`  • Waiting 10s for final cooldown & settlement...`);
  await sleep(10000);
  const enduranceSettled = sample("Test G - Long-Duration Endurance", 1, 2000, "cooldown-settled");
  const totalDelta = enduranceSettled.totalFootprintMb - enduranceBase.totalFootprintMb;
  console.log(`  • Final Settled Footprint: ${enduranceSettled.totalFootprintMb.toFixed(1)} MB (Net Delta: ${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(1)} MB, CPU: ${enduranceSettled.webKit.cpuPct.toFixed(1)}%)`);

  // =========================================================================
  // FINAL LEAKS CHECK VIA /usr/bin/leaks
  // =========================================================================
  console.log("\n▶ [Memory Diagnostics] Running macOS /usr/bin/leaks on native and WebKit targets...");
  if (globalTauriPid) {
    const tauriLeaks = sh(`leaks ${globalTauriPid} 2>/dev/null | grep -E "leaks for|ROOT LEAK" || true`);
    console.log(`  • Native Tauri (PID ${globalTauriPid}) Leaks Diagnostic:\n    ${tauriLeaks || "No leaks detected"}`);
  }
  if (globalWebKitPid) {
    const webKitLeaks = sh(`leaks ${globalWebKitPid} 2>/dev/null | grep -E "leaks for|ROOT LEAK" || true`);
    console.log(`  • WebKit WebContent (PID ${globalWebKitPid}) Leaks Diagnostic:\n    ${webKitLeaks || "No leaks detected"}`);
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("🏁 COMPREHENSIVE MEMORY AUDIT COMPLETED. Results written to CSV.");
  console.log("══════════════════════════════════════════════════════════════════");
}

runComprehensiveAudit().catch(console.error);
