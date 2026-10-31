/// <reference types="node" />
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'benchmarks/audits/2026-10-30-dff5449');
const RAW_DIR = path.join(AUDIT_DIR, 'raw');
const CHARTS_DIR = path.join(AUDIT_DIR, 'charts');

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err: any) {
    return (err.stdout || err.stderr || '').toString().trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ProcStats {
  pid: number;
  rssMb: number;
  physFootprintMb: number;
  peakFootprintMb: number;
  cpuPct: number;
  threads: number;
}

interface SampleRecord {
  phase: 'baseline' | 'in-progress' | 'end-of-workload' | 'cooldown-10s' | 'cooldown-30s' | 'cooldown-60s';
  milestoneOps: number;
  timestamp: string;
  tauri: ProcStats;
  webKit: ProcStats;
  totalFootprintMb: number;
}

function findPids(): { tauriPid: number | null; webKitPid: number | null } {
  const tauriOut = sh("pgrep -x raynote || pgrep -f 'rayNote.app/Contents/MacOS/raynote'");
  const tauriPids = tauriOut.split('\n').filter(Boolean).map((p) => parseInt(p.trim(), 10));
  const tauriPid = tauriPids[0] || null;

  let webKitPid: number | null = null;
  const webKitPids = sh("pgrep -f 'com.apple.WebKit.WebContent'").split('\n').filter(Boolean);
  for (const pidStr of webKitPids) {
    const pid = parseInt(pidStr.trim(), 10);
    const openFiles = sh(`lsof -p ${pid} 2>/dev/null | grep 'com.raynote.desktop'`);
    if (openFiles.length > 0) {
      webKitPid = pid;
      break;
    }
  }

  return { tauriPid, webKitPid };
}

function getProcessStats(pid: number): ProcStats {
  let rssMb = 0;
  let cpuPct = 0;
  let threads = 0;
  let physFootprintMb = 0;
  let peakFootprintMb = 0;

  const psOut = sh(`ps -o rss=,%cpu=,nlwp= -p ${pid} 2>/dev/null || true`);
  if (psOut) {
    const parts = psOut.trim().split(/\s+/);
    if (parts.length >= 2) {
      const rssKb = parseFloat(parts[0]);
      if (!isNaN(rssKb)) rssMb = Math.round((rssKb / 1024) * 100) / 100;
      const cpu = parseFloat(parts[1]);
      if (!isNaN(cpu)) cpuPct = cpu;
      if (parts.length >= 3) {
        const th = parseInt(parts[2], 10);
        if (!isNaN(th)) threads = th;
      }
    }
  }

  const fpOut = sh(`footprint ${pid} 2>/dev/null || true`);
  const fpMatch = fpOut.match(/Footprint:\s*(\d+(?:\.\d+)?)\s*MB/i);
  if (fpMatch) {
    physFootprintMb = parseFloat(fpMatch[1]);
  } else {
    const bMatch = fpOut.match(/Footprint:\s*(\d+)\s*B/i);
    if (bMatch) physFootprintMb = Math.round((parseInt(bMatch[1], 10) / (1024 * 1024)) * 100) / 100;
  }

  const peakMatch = fpOut.match(/phys_footprint_peak:\s*(\d+(?:\.\d+)?)\s*MB/i);
  if (peakMatch) {
    peakFootprintMb = parseFloat(peakMatch[1]);
  } else {
    const bMatch = fpOut.match(/phys_footprint_peak:\s*(\d+)\s*B/i);
    if (bMatch) peakFootprintMb = Math.round((parseInt(bMatch[1], 10) / (1024 * 1024)) * 100) / 100;
  }

  return { pid, rssMb, physFootprintMb, peakFootprintMb, cpuPct, threads };
}

function sampleDual(phase: SampleRecord['phase'], ops: number, expectedTauriPid: number, expectedWebKitPid: number): SampleRecord {
  const pids = findPids();
  if (pids.tauriPid !== expectedTauriPid || pids.webKitPid !== expectedWebKitPid) {
    throw new Error(`Process PID mismatch! Expected Tauri ${expectedTauriPid}, WebKit ${expectedWebKitPid}, but found Tauri ${pids.tauriPid}, WebKit ${pids.webKitPid}`);
  }

  const tauri = getProcessStats(expectedTauriPid);
  const webKit = getProcessStats(expectedWebKitPid);
  const totalFootprintMb = Math.round((tauri.physFootprintMb + webKit.physFootprintMb) * 100) / 100;

  return {
    phase,
    milestoneOps: ops,
    timestamp: new Date().toISOString(),
    tauri,
    webKit,
    totalFootprintMb
  };
}

async function restartApp(): Promise<{ tauriPid: number; webKitPid: number }> {
  sh("pkill -9 -x raynote || true");
  await sleep(1500);
  sh("open /Applications/rayNote.app");
  let tauriPid: number | null = null;
  let webKitPid: number | null = null;
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    const pids = findPids();
    if (pids.tauriPid && pids.webKitPid) {
      tauriPid = pids.tauriPid;
      webKitPid = pids.webKitPid;
      break;
    }
  }
  if (!tauriPid || !webKitPid) {
    throw new Error("Failed to restart rayNote.");
  }
  sh("osascript -e 'tell application \"rayNote\" to activate' 2>/dev/null || true");
  await sleep(1500);
  return { tauriPid, webKitPid };
}

async function runReproduction() {
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("🔬 rayNote Endurance Memory Reproduction (3 Clean 2,000-Switch Runs)");
  console.log("══════════════════════════════════════════════════════════════════════════════\n");

  const milestones = [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000];
  const runs: any[] = [];

  for (let rep = 1; rep <= 3; rep++) {
    console.log(`──────────────────────────────────────────────────────────────────────────────`);
    console.log(`▶ REPRODUCTION RUN #${rep} of 3 (2,000 Operations, Clean Process Launch)`);
    console.log(`──────────────────────────────────────────────────────────────────────────────`);

    const { tauriPid, webKitPid } = await restartApp();
    console.log(`  Target Processes Verified: Native PID ${tauriPid}, WebKit PID ${webKitPid}`);
    await sleep(3000);

    const samples: SampleRecord[] = [];

    // Milestone 0: Baseline
    const baseSample = sampleDual('baseline', 0, tauriPid, webKitPid);
    samples.push(baseSample);
    console.log(`  [Milestone    0] Total: ${baseSample.totalFootprintMb} MB (Tauri: ${baseSample.tauri.physFootprintMb} MB, WebKit: ${baseSample.webKit.physFootprintMb} MB) | RSS: Tauri ${baseSample.tauri.rssMb} MB, WebKit ${baseSample.webKit.rssMb} MB`);

    // In-progress milestones
    for (const m of milestones) {
      sh("./scripts/native_key_driver switch_and_type 200");
      sh('./scripts/native_key_driver type " [audit verification typing burst]"');
      await sleep(300);

      const isEnd = m === 2000;
      const sample = sampleDual(isEnd ? 'end-of-workload' : 'in-progress', m, tauriPid, webKitPid);
      samples.push(sample);
      console.log(`  [Milestone ${m.toString().padStart(4)}] Total: ${sample.totalFootprintMb} MB (Tauri: ${sample.tauri.physFootprintMb} MB, WebKit: ${sample.webKit.physFootprintMb} MB) | RSS: Tauri ${sample.tauri.rssMb} MB, WebKit ${sample.webKit.rssMb} MB`);
    }

    // Cooldown 10s
    console.log(`  ⏳ Waiting 10s cooldown...`);
    await sleep(10000);
    const cd10 = sampleDual('cooldown-10s', 2000, tauriPid, webKitPid);
    samples.push(cd10);
    console.log(`  [Cooldown 10s] Total: ${cd10.totalFootprintMb} MB (Tauri: ${cd10.tauri.physFootprintMb} MB, WebKit: ${cd10.webKit.physFootprintMb} MB)`);

    // Cooldown 30s
    console.log(`  ⏳ Waiting 20s additional cooldown (total 30s)...`);
    await sleep(20000);
    const cd30 = sampleDual('cooldown-30s', 2000, tauriPid, webKitPid);
    samples.push(cd30);
    console.log(`  [Cooldown 30s] Total: ${cd30.totalFootprintMb} MB (Tauri: ${cd30.tauri.physFootprintMb} MB, WebKit: ${cd30.webKit.physFootprintMb} MB)`);

    // Cooldown 60s
    console.log(`  ⏳ Waiting 30s additional cooldown (total 60s)...`);
    await sleep(30000);
    const cd60 = sampleDual('cooldown-60s', 2000, tauriPid, webKitPid);
    samples.push(cd60);
    console.log(`  [Cooldown 60s] Total: ${cd60.totalFootprintMb} MB (Tauri: ${cd60.tauri.physFootprintMb} MB, WebKit: ${cd60.webKit.physFootprintMb} MB)`);

    // TRUE PEAK across COMPLETE time series
    let truePeak = samples[0];
    for (const s of samples) {
      if (s.totalFootprintMb > truePeak.totalFootprintMb) {
        truePeak = s;
      }
    }

    const netChange60s = Math.round((cd60.totalFootprintMb - baseSample.totalFootprintMb) * 100) / 100;
    const endWorkload = samples.find(s => s.phase === 'end-of-workload')!;

    console.log(`\n  ★ Run #${rep} Summary:`);
    console.log(`    Initial Footprint:     ${baseSample.totalFootprintMb} MB`);
    console.log(`    End-of-Workload (2k):  ${endWorkload.totalFootprintMb} MB`);
    console.log(`    True Peak (Full Series): ${truePeak.totalFootprintMb} MB (Phase: ${truePeak.phase}, Milestone: ${truePeak.milestoneOps})`);
    console.log(`    10s Cooldown:          ${cd10.totalFootprintMb} MB`);
    console.log(`    60s Cooldown:          ${cd60.totalFootprintMb} MB`);
    console.log(`    Net Change (60s - 0):  ${netChange60s >= 0 ? '+' : ''}${netChange60s} MB\n`);

    runs.push({
      rep,
      pids: { tauriPid, webKitPid },
      initialFootprint: baseSample.totalFootprintMb,
      endOfWorkloadFootprint: endWorkload.totalFootprintMb,
      truePeak: {
        totalFootprintMb: truePeak.totalFootprintMb,
        tauriMb: truePeak.tauri.physFootprintMb,
        webKitMb: truePeak.webKit.physFootprintMb,
        phase: truePeak.phase,
        milestoneOps: truePeak.milestoneOps
      },
      cooldown10sFootprint: cd10.totalFootprintMb,
      cooldown30sFootprint: cd30.totalFootprintMb,
      cooldown60sFootprint: cd60.totalFootprintMb,
      netChange60s,
      samples
    });
  }

  const outPath = path.join(RAW_DIR, 'reproduction_endurance_results.json');
  fs.writeFileSync(outPath, JSON.stringify(runs, null, 2), 'utf8');
  console.log(`\n✓ Reproduction data saved to ${outPath}`);
}

runReproduction().catch((err) => {
  console.error("FATAL ERROR in reproduction runner:", err);
  process.exit(1);
});

