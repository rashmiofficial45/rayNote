/// <reference types="node" />
import { execSync } from "child_process";
import fs from "fs";

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: any) {
    return (err.stdout || err.stderr || "").toString().trim();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFootprints(): { tauriMb: number; webkitMb: number; totalMb: number } {
  const tauriOut = sh("pgrep -f 'rayNote.app/Contents/MacOS/raynote'");
  const tauriPids = tauriOut.split("\n").filter(Boolean).map((p) => parseInt(p.trim(), 10));
  const tauriPid = tauriPids[0] || null;

  let webKitPid: number | null = null;
  const webKitPids = sh("pgrep -f 'com.apple.WebKit.WebContent'").split("\n").filter(Boolean);
  for (const pidStr of webKitPids) {
    const pid = parseInt(pidStr.trim(), 10);
    const openFiles = sh(`lsof -p ${pid} 2>/dev/null | grep 'com.raynote.desktop'`);
    if (openFiles.length > 0) {
      webKitPid = pid;
      break;
    }
  }

  let tauriMb = 0;
  if (tauriPid) {
    const out = sh(`footprint ${tauriPid} 2>/dev/null`);
    const match = out.match(/Footprint:\s*(\d+)\s*MB/i);
    if (match) tauriMb = parseInt(match[1], 10);
  }

  let webkitMb = 0;
  if (webKitPid) {
    const out = sh(`footprint ${webKitPid} 2>/dev/null`);
    const match = out.match(/Footprint:\s*(\d+)\s*MB/i);
    if (match) webkitMb = parseInt(match[1], 10);
  }

  return { tauriMb, webkitMb, totalMb: tauriMb + webkitMb };
}

async function runThroughMemoryTest() {
  console.log("=================================================================");
  console.log("🔬 rayNote Deep Memory & Stress Benchmark Suite");
  console.log("=================================================================\n");

  // Step 1: Baseline measurement
  console.log("▶ [1/5] Measuring Settled Baseline Memory...");
  sh("open -a rayNote");
  await sleep(1500);

  const baseline = getFootprints();
  console.log(`  • Baseline Tauri Native Footprint:    ${baseline.tauriMb} MB`);
  console.log(`  • Baseline WebKit WebContent Footprint: ${baseline.webkitMb} MB`);
  console.log(`  • Baseline Total Combined Footprint:  ${baseline.totalMb} MB\n`);

  // Step 2: 50 Rapid Note Switches
  console.log("▶ [2/5] Running Phase 1 Stress (50 rapid note switches)...");
  for (let i = 0; i < 50; i++) {
    sh("osascript -e 'tell application \"System Events\" to key code 125 using {option down}'");
    await sleep(25);
  }
  await sleep(500);
  const p1 = getFootprints();
  console.log(`  • Post-50-Switches Footprint:         ${p1.totalMb} MB (WebKit: ${p1.webkitMb} MB)\n`);

  // Step 3: 100 Cumulative Switches
  console.log("▶ [3/5] Running Phase 2 Stress (100 cumulative note switches)...");
  for (let i = 0; i < 50; i++) {
    sh("osascript -e 'tell application \"System Events\" to key code 126 using {option down}'");
    await sleep(25);
  }
  await sleep(500);
  const p2 = getFootprints();
  console.log(`  • Post-100-Switches Footprint:        ${p2.totalMb} MB (WebKit: ${p2.webkitMb} MB)\n`);

  // Step 4: 200 Cumulative Switches (Severe endurance test)
  console.log("▶ [4/5] Running Phase 3 Severe Endurance (200 cumulative note switches)...");
  for (let i = 0; i < 100; i++) {
    const code = i % 2 === 0 ? 125 : 126;
    sh(`osascript -e 'tell application "System Events" to key code ${code} using {option down}'`);
    await sleep(20);
  }
  await sleep(500);
  const p3 = getFootprints();
  console.log(`  • Post-200-Switches Peak Footprint:   ${p3.totalMb} MB (WebKit: ${p3.webkitMb} MB)\n`);

  // Step 5: Stabilization & GC Cooldown
  console.log("▶ [5/5] Measuring Stabilization, GC Settlement & Idle CPU...");
  console.log("  → Waiting 6 seconds for WebKit GC & smooth caret idle cutoff...");
  await sleep(6000);

  const settled = getFootprints();
  console.log(`  • Settled Post-Stress Footprint:      ${settled.totalMb} MB`);
  console.log(`    - Tauri Native:                     ${settled.tauriMb} MB`);
  console.log(`    - WebKit WebContent:                ${settled.webkitMb} MB`);
  console.log(`  • Net Memory Delta (Settled - Base):  +${settled.totalMb - baseline.totalMb} MB`);

  // Step 6: Measure 5-sample Idle CPU
  console.log("\n▶ Measuring Idle CPU Consumption...");
  const tauriOut = sh("pgrep -f 'rayNote.app/Contents/MacOS/raynote'");
  const tauriPid = parseInt(tauriOut.split("\n")[0] || "0", 10);
  let webKitPid = 0;
  const webKitPids = sh("pgrep -f 'com.apple.WebKit.WebContent'").split("\n").filter(Boolean);
  for (const pidStr of webKitPids) {
    const pid = parseInt(pidStr.trim(), 10);
    const openFiles = sh(`lsof -p ${pid} 2>/dev/null | grep 'com.raynote.desktop'`);
    if (openFiles.length > 0) {
      webKitPid = pid;
      break;
    }
  }

  const cpuSamples: number[] = [];
  for (let i = 0; i < 3; i++) {
    await sleep(1000);
    const cpuStr = sh(`top -l 1 -stats pid,cpu -pid ${webKitPid} 2>/dev/null | awk -v p="${webKitPid}" '$1 == p {print $2}'`);
    const cpu = parseFloat(cpuStr) || 0;
    cpuSamples.push(cpu);
  }
  const avgCpu = cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length;
  console.log(`  • WebKit WebContent Idle CPU:         ${avgCpu.toFixed(1)}% (Samples: ${cpuSamples.join("%, ")}%)`);

  console.log("\n=================================================================");
  console.log("🏁 DEEP MEMORY BENCHMARK COMPLETED");
  console.log("=================================================================");
}

runThroughMemoryTest().catch(console.error);
