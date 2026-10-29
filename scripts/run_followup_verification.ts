import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface ProcMemory {
  pid: number;
  rssMb: number;
  physFootprintMb: number;
  cpuPct: number;
}

interface MeasurementSample {
  testName: string;
  repetition: number;
  milestone: number | string;
  phase: string;
  tauri: ProcMemory;
  webKit: ProcMemory;
  totalFootprintMb: number;
  timestamp: string;
}

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: any) {
    if (err.stdout) return err.stdout.toString().trim();
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getExistingWebContentPids(): Set<number> {
  const out = sh("pgrep -f com.apple.WebKit.WebContent || true");
  const pids = new Set<number>();
  for (const line of out.split("\n")) {
    const p = parseInt(line.trim(), 10);
    if (!isNaN(p)) pids.add(p);
  }
  return pids;
}

async function launchRayNote(): Promise<{ tauriPid: number; webKitPid: number }> {
  sh("pkill -9 -x raynote || true");
  await sleep(1500);

  const existingWebPids = getExistingWebContentPids();
  sh("open /Applications/rayNote.app");

  let tauriPid = 0;
  let webKitPid = 0;

  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(500);
    if (!tauriPid) {
      const p = parseInt(sh("pgrep -x raynote || true"), 10);
      if (!isNaN(p) && p > 0) tauriPid = p;
    }

    if (!webKitPid) {
      const currentWebPids = getExistingWebContentPids();
      for (const p of currentWebPids) {
        if (!existingWebPids.has(p)) {
          webKitPid = p;
          break;
        }
      }
    }

    if (tauriPid && webKitPid) break;
  }

  if (!tauriPid || !webKitPid) {
    throw new Error(`Failed to discover rayNote processes: tauri=${tauriPid}, webkit=${webKitPid}`);
  }

  // Focus raynote
  sh(`osascript -e 'tell application "rayNote" to activate' 2>/dev/null || true`);
  await sleep(1000);

  return { tauriPid, webKitPid };
}

function getProcessStats(pid: number): ProcMemory {
  let rssMb = 0;
  let cpuPct = 0;
  let physFootprintMb = 0;

  const psOut = sh(`ps -o rss=,%cpu= -p ${pid} 2>/dev/null || true`);
  if (psOut) {
    const parts = psOut.trim().split(/\s+/);
    if (parts.length >= 2) {
      const rssKb = parseFloat(parts[0]);
      if (!isNaN(rssKb)) rssMb = Math.round((rssKb / 1024) * 100) / 100;
      const cpu = parseFloat(parts[1]);
      if (!isNaN(cpu)) cpuPct = cpu;
    }
  }

  const fpOut = sh(`footprint ${pid} -f bytes --noCategories 2>/dev/null || true`);
  const match = fpOut.match(/Footprint:\s+(\d+)\s+B/i) || fpOut.match(/phys_footprint:\s+(\d+)\s+B/i);
  if (match) {
    const bytes = parseInt(match[1], 10);
    physFootprintMb = Math.round((bytes / (1024 * 1024)) * 100) / 100;
  } else {
    // Fallback: top
    const topOut = sh(`top -l 1 -stats pid,command,mem -pid ${pid} 2>/dev/null | grep "${pid}" || true`);
    const topMatch = topOut.match(/(\d+(?:\.\d+)?)M/);
    if (topMatch) physFootprintMb = parseFloat(topMatch[1]);
  }

  return { pid, rssMb, physFootprintMb, cpuPct };
}

function sampleProcessPair(
  testName: string,
  rep: number,
  milestone: number | string,
  phase: string,
  tauriPid: number,
  webKitPid: number
): MeasurementSample {
  const tauri = getProcessStats(tauriPid);
  const webKit = getProcessStats(webKitPid);
  const totalFootprintMb = Math.round((tauri.physFootprintMb + webKit.physFootprintMb) * 100) / 100;

  return {
    testName,
    repetition: rep,
    milestone,
    phase,
    tauri,
    webKit,
    totalFootprintMb,
    timestamp: new Date().toISOString(),
  };
}

const csvHeader = [
  "Test_Name",
  "Repetition",
  "Milestone_Ops",
  "Phase",
  "Native_PID",
  "Native_RSS_MB",
  "Native_Footprint_MB",
  "Native_CPU_Pct",
  "WebKit_PID",
  "WebKit_RSS_MB",
  "WebKit_Footprint_MB",
  "WebKit_CPU_Pct",
  "Total_Footprint_MB",
  "Timestamp",
].join(",");

function formatCsvRow(s: MeasurementSample): string {
  return [
    `"${s.testName}"`,
    s.repetition,
    `"${s.milestone}"`,
    `"${s.phase}"`,
    s.tauri.pid,
    s.tauri.rssMb.toFixed(2),
    s.tauri.physFootprintMb.toFixed(2),
    s.tauri.cpuPct.toFixed(1),
    s.webKit.pid,
    s.webKit.rssMb.toFixed(2),
    s.webKit.physFootprintMb.toFixed(2),
    s.webKit.cpuPct.toFixed(1),
    s.totalFootprintMb.toFixed(2),
    `"${s.timestamp}"`,
  ].join(",");
}

async function runEnduranceAudit(): Promise<void> {
  const csvPath = path.resolve(process.cwd(), "MEMORY_LEAK_VERIFICATION_RESULTS.csv");
  const rawLogsDir = path.resolve(process.cwd(), "MEMORY_LEAK_VERIFICATION_RAW_LOGS");

  if (!fs.existsSync(rawLogsDir)) {
    fs.mkdirSync(rawLogsDir, { recursive: true });
  }

  fs.writeFileSync(csvPath, csvHeader + "\n", "utf8");

  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("🔬 rayNote Follow-up Memory Leak Verification & Benchmark Integrity Suite");
  console.log("══════════════════════════════════════════════════════════════════════════════\n");

  const milestones = [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000];

  for (let rep = 1; rep <= 3; rep++) {
    console.log(`\n──────────────────────────────────────────────────────────────────────────────`);
    console.log(`▶ ENDURANCE WORKLOAD RUN #${rep} of 3 (2,000 Operations, Clean Launch)`);
    console.log(`──────────────────────────────────────────────────────────────────────────────`);

    const { tauriPid, webKitPid } = await launchRayNote();
    console.log(`  ✓ Spawned Target Processes: Native PID ${tauriPid}, WebKit PID ${webKitPid}`);

    // Wait 3s to let dynamic linking settle
    await sleep(3000);

    // Initial baseline sample (0 ops)
    const baseSample = sampleProcessPair("Phase 4 - Endurance Workload", rep, 0, "baseline", tauriPid, webKitPid);
    fs.appendFileSync(csvPath, formatCsvRow(baseSample) + "\n", "utf8");
    console.log(`  [Milestone    0] Footprint: ${baseSample.totalFootprintMb.toFixed(2)} MB (Native: ${baseSample.tauri.physFootprintMb.toFixed(2)} MB, WebKit: ${baseSample.webKit.physFootprintMb.toFixed(2)} MB) | RSS: Native ${baseSample.tauri.rssMb.toFixed(2)} MB, WebKit ${baseSample.webKit.rssMb.toFixed(2)} MB`);

    let peakSample = { ...baseSample };

    // Execute in 200-op chunks
    for (const milestone of milestones) {
      // 200 switches
      sh("./scripts/native_key_driver switch_and_type 200");
      // Periodic typing edit (same as original script)
      sh('./scripts/native_key_driver type " Periodic endurance verification note edit."');
      await sleep(400);

      const mSample = sampleProcessPair("Phase 4 - Endurance Workload", rep, milestone, "in-progress", tauriPid, webKitPid);
      fs.appendFileSync(csvPath, formatCsvRow(mSample) + "\n", "utf8");

      if (mSample.totalFootprintMb > peakSample.totalFootprintMb) {
        peakSample = { ...mSample, phase: "peak" };
      }

      console.log(`  [Milestone ${milestone.toString().padStart(4)}] Footprint: ${mSample.totalFootprintMb.toFixed(2)} MB (Native: ${mSample.tauri.physFootprintMb.toFixed(2)} MB, WebKit: ${mSample.webKit.physFootprintMb.toFixed(2)} MB) | RSS: Native ${mSample.tauri.rssMb.toFixed(2)} MB, WebKit ${mSample.webKit.rssMb.toFixed(2)} MB`);
    }

    // Record Peak
    peakSample.phase = "peak";
    fs.appendFileSync(csvPath, formatCsvRow(peakSample) + "\n", "utf8");
    console.log(`  ★ PEAK Total Footprint: ${peakSample.totalFootprintMb.toFixed(2)} MB (Native: ${peakSample.tauri.physFootprintMb.toFixed(2)} MB, WebKit: ${peakSample.webKit.physFootprintMb.toFixed(2)} MB)`);

    // Cooldown interval (10 seconds)
    console.log(`  ⏳ Cooldown interval: Waiting 10s for WebKit GC, autosave drain & SQLite checkpointing...`);
    await sleep(10000);

    const settledSample = sampleProcessPair("Phase 4 - Endurance Workload", rep, 2000, "cooldown-settled", tauriPid, webKitPid);
    fs.appendFileSync(csvPath, formatCsvRow(settledSample) + "\n", "utf8");

    const netGrowth = Math.round((settledSample.totalFootprintMb - baseSample.totalFootprintMb) * 100) / 100;
    console.log(`  ✓ SETTLED Total Footprint: ${settledSample.totalFootprintMb.toFixed(2)} MB (Native: ${settledSample.tauri.physFootprintMb.toFixed(2)} MB, WebKit: ${settledSample.webKit.physFootprintMb.toFixed(2)} MB)`);
    console.log(`    Net Footprint Delta: ${netGrowth >= 0 ? "+" : ""}${netGrowth.toFixed(2)} MB`);

    // In repetition 3, capture raw diagnostics
    if (rep === 3) {
      console.log(`\n  📸 Capturing raw diagnostic system outputs into ${rawLogsDir}...`);
      
      const fpRaw = sh(`footprint ${tauriPid} ${webKitPid}`);
      fs.writeFileSync(path.join(rawLogsDir, "footprint_settled.txt"), fpRaw, "utf8");

      const vmmapTauri = sh(`vmmap -summary ${tauriPid}`);
      fs.writeFileSync(path.join(rawLogsDir, "vmmap_tauri_settled.txt"), vmmapTauri, "utf8");

      const vmmapWebKit = sh(`vmmap -summary ${webKitPid}`);
      fs.writeFileSync(path.join(rawLogsDir, "vmmap_webkit_settled.txt"), vmmapWebKit, "utf8");

      const leaksTauri = sh(`leaks ${tauriPid} --nostacks --quiet 2>&1 || true`);
      fs.writeFileSync(path.join(rawLogsDir, "leaks_tauri.txt"), leaksTauri, "utf8");

      const leaksWebKit = sh(`leaks ${webKitPid} --nostacks --quiet 2>&1 || true`);
      fs.writeFileSync(path.join(rawLogsDir, "leaks_webkit.txt"), leaksWebKit, "utf8");

      const topRaw = sh(`top -l 1 -stats pid,command,mem,rprvt,purg,vsize -pid ${tauriPid} -pid ${webKitPid}`);
      fs.writeFileSync(path.join(rawLogsDir, "top_snapshot.txt"), topRaw, "utf8");
      
      console.log(`    ✓ Raw footprint, vmmap, leaks, and top captured successfully.`);
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════════════════════");
  console.log("🏁 VERIFICATION SUITE FINISHED. Results saved to MEMORY_LEAK_VERIFICATION_RESULTS.csv");
  console.log("══════════════════════════════════════════════════════════════════════════════\n");
}

runEnduranceAudit().catch((err) => {
  console.error("FATAL ERROR in endurance audit:", err);
  process.exit(1);
});
