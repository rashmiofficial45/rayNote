import { execSync, spawn } from 'child_process';
import fs from 'fs';

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return (err.stdout || err.stderr || '').toString().trim();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findPids() {
  const tauriOut = sh("pgrep -f 'rayNote.app/Contents/MacOS/raynote'");
  const tauriPids = tauriOut.split('\n').filter(Boolean).map((p) => parseInt(p.trim(), 10));
  const tauriPid = tauriPids[0] || null;

  // Find the WebKit.WebContent process corresponding to rayNote
  const webKitOut = sh("ps -ef | grep 'com.apple.WebKit.WebContent' | grep -v grep");
  const webKitLines = webKitOut.split('\n').filter(Boolean);
  
  // Pick the most recent WebContent process (launched alongside rayNote)
  let webKitPid = null;
  if (webKitLines.length > 0) {
    const lastLine = webKitLines[webKitLines.length - 1];
    const parts = lastLine.trim().split(/\s+/);
    webKitPid = parseInt(parts[1], 10);
  }

  return { tauriPid, webKitPid };
}

function getFootprint(pid) {
  if (!pid) return { footprintMb: 0, peakMb: 0, raw: '' };
  const out = sh(`footprint ${pid} 2>/dev/null`);
  let footprintMb = 0;
  let peakMb = 0;

  const fpMatch = out.match(/Footprint:\s*(\d+)\s*MB/i);
  if (fpMatch) footprintMb = parseInt(fpMatch[1], 10);

  const peakMatch = out.match(/phys_footprint_peak:\s*(\d+)\s*MB/i);
  if (peakMatch) peakMb = parseInt(peakMatch[1], 10);

  return { footprintMb, peakMb, raw: out };
}

function getTopStats(pid) {
  if (!pid) return { cpu: 0, mem: '0M', threads: 0 };
  const out = sh(`top -pid ${pid} -stats pid,cpu,mem,threads,command -l 2 -s 1 | tail -n 1`);
  const parts = out.trim().split(/\s+/);
  if (parts.length >= 4) {
    return {
      cpu: parseFloat(parts[1]) || 0,
      mem: parts[2] || '0M',
      threads: parseInt(parts[3], 10) || 0,
    };
  }
  return { cpu: 0, mem: '0M', threads: 0 };
}

function switchNextNote() {
  sh(`osascript -e 'tell application "System Events" to tell process "raynote" to key code 125 using {option down}'`);
}

async function runBenchmarks() {
  console.log('🚀 Initiating rayNote Production Benchmark Harness on macOS...\n');

  // Step 1: Find PIDs
  let { tauriPid, webKitPid } = findPids();
  if (!tauriPid) {
    console.log('Launching rayNote.app...');
    sh('open "/Users/rashmipersonal/Desktop/MAC Apps/rayNote/src-tauri/target/release/bundle/macos/rayNote.app"');
    await sleep(2000);
    ({ tauriPid, webKitPid } = findPids());
  }

  console.log(`📍 Identified Targets:`);
  console.log(`   - rayNote Native Process PID:       ${tauriPid}`);
  console.log(`   - WebKit WebContent Process PID:   ${webKitPid}\n`);

  const results = [];

  // ==========================================
  // Test 1: Fresh Launch Baseline
  // ==========================================
  console.log('⏳ Running Test 1: Fresh Launch Baseline...');
  const tauriFp1 = getFootprint(tauriPid);
  const webKitFp1 = getFootprint(webKitPid);
  const tauriTop1 = getTopStats(tauriPid);
  const webKitTop1 = getTopStats(webKitPid);
  const totalFp1 = tauriFp1.footprintMb + webKitFp1.footprintMb;

  results.push({
    scenario: 'Fresh Launch',
    tauriFp: tauriFp1.footprintMb,
    webKitFp: webKitFp1.footprintMb,
    totalFp: totalFp1,
    tauriCpu: tauriTop1.cpu,
    webKitCpu: webKitTop1.cpu,
    threads: tauriTop1.threads + webKitTop1.threads,
    expected: 'Clean Baseline (~150-170 MB)',
  });
  console.log(`   ✅ Total Footprint: ${totalFp1} MB (Tauri: ${tauriFp1.footprintMb} MB, WebKit: ${webKitFp1.footprintMb} MB)\n`);

  // ==========================================
  // Test 2: Idle Stability (30 seconds idle)
  // ==========================================
  console.log('⏳ Running Test 2: Idle Stability (Sampling over 15 seconds)...');
  await sleep(15000);
  const tauriFp2 = getFootprint(tauriPid);
  const webKitFp2 = getFootprint(webKitPid);
  const tauriTop2 = getTopStats(tauriPid);
  const webKitTop2 = getTopStats(webKitPid);
  const totalFp2 = tauriFp2.footprintMb + webKitFp2.footprintMb;

  results.push({
    scenario: 'Idle (Post-Boot)',
    tauriFp: tauriFp2.footprintMb,
    webKitFp: webKitFp2.footprintMb,
    totalFp: totalFp2,
    tauriCpu: tauriTop2.cpu,
    webKitCpu: webKitTop2.cpu,
    threads: tauriTop2.threads + webKitTop2.threads,
    expected: 'Stable Footprint, CPU ~0.0%',
  });
  console.log(`   ✅ Idle CPU: Tauri ${tauriTop2.cpu}%, WebKit ${webKitTop2.cpu}% | Total Footprint: ${totalFp2} MB\n`);

  // ==========================================
  // Test 3: 5 Small Notes (5x 20 KB)
  // ==========================================
  console.log('⏳ Running Test 3: Opening 5 Small Notes (20 KB each)...');
  for (let i = 0; i < 5; i++) {
    switchNextNote();
    await sleep(350); // realistic user switch speed
  }
  await sleep(2000);
  const tauriFp3 = getFootprint(tauriPid);
  const webKitFp3 = getFootprint(webKitPid);
  const tauriTop3 = getTopStats(tauriPid);
  const webKitTop3 = getTopStats(webKitPid);
  const totalFp3 = tauriFp3.footprintMb + webKitFp3.footprintMb;

  results.push({
    scenario: '5 Small Notes (20 KB ea)',
    tauriFp: tauriFp3.footprintMb,
    webKitFp: webKitFp3.footprintMb,
    totalFp: totalFp3,
    tauriCpu: tauriTop3.cpu,
    webKitCpu: webKitTop3.cpu,
    threads: tauriTop3.threads + webKitTop3.threads,
    expected: 'Minimal RAM change (< 5 MB delta)',
  });
  console.log(`   ✅ Total Footprint: ${totalFp3} MB\n`);

  // ==========================================
  // Test 4: 25 Realistic Notes (5x 20K, 5x 100K, 5x 250K, 5x 500K, 5x 1M)
  // ==========================================
  console.log('⏳ Running Test 4: Opening Full 25 Realistic Notes (up to 1 MB)...');
  for (let i = 0; i < 20; i++) {
    switchNextNote();
    await sleep(400); // 400ms per switch
  }
  await sleep(3000); // Let settle
  const tauriFp4 = getFootprint(tauriPid);
  const webKitFp4 = getFootprint(webKitPid);
  const tauriTop4 = getTopStats(tauriPid);
  const webKitTop4 = getTopStats(webKitPid);
  const totalFp4 = tauriFp4.footprintMb + webKitFp4.footprintMb;

  results.push({
    scenario: '25 Realistic Notes Loaded',
    tauriFp: tauriFp4.footprintMb,
    webKitFp: webKitFp4.footprintMb,
    totalFp: totalFp4,
    tauriCpu: tauriTop4.cpu,
    webKitCpu: webKitTop4.cpu,
    threads: tauriTop4.threads + webKitTop4.threads,
    expected: 'Memory strictly bounded by 8MB budget',
  });
  console.log(`   ✅ Total Footprint: ${totalFp4} MB (Tauri: ${tauriFp4.footprintMb} MB, WebKit: ${webKitFp4.footprintMb} MB)\n`);

  // ==========================================
  // Test 5: Rapid Stress Test (50 switches)
  // ==========================================
  console.log('⏳ Running Test 5: Rapid Switching Stress Test (50 consecutive switches)...');
  for (let i = 0; i < 50; i++) {
    switchNextNote();
    await sleep(100); // rapid cycling
  }
  await sleep(2000);
  const tauriFp5 = getFootprint(tauriPid);
  const webKitFp5 = getFootprint(webKitPid);
  const tauriTop5 = getTopStats(tauriPid);
  const webKitTop5 = getTopStats(webKitPid);
  const totalFp5 = tauriFp5.footprintMb + webKitFp5.footprintMb;

  results.push({
    scenario: '50 Rapid Switches',
    tauriFp: tauriFp5.footprintMb,
    webKitFp: webKitFp5.footprintMb,
    totalFp: totalFp5,
    tauriCpu: tauriTop5.cpu,
    webKitCpu: webKitTop5.cpu,
    threads: tauriTop5.threads + webKitTop5.threads,
    expected: 'No memory runaway',
  });
  console.log(`   ✅ Total Footprint: ${totalFp5} MB\n`);

  // ==========================================
  // Test 6: Extended Endurance Test (100 total switches)
  // ==========================================
  console.log('⏳ Running Test 6: Extended Endurance Test (50 more switches = 100 total)...');
  for (let i = 0; i < 50; i++) {
    switchNextNote();
    await sleep(80); // very fast cycling
  }
  await sleep(3000);
  const tauriFp6 = getFootprint(tauriPid);
  const webKitFp6 = getFootprint(webKitPid);
  const tauriTop6 = getTopStats(tauriPid);
  const webKitTop6 = getTopStats(webKitPid);
  const totalFp6 = tauriFp6.footprintMb + webKitFp6.footprintMb;

  results.push({
    scenario: '100 Rapid Switches',
    tauriFp: tauriFp6.footprintMb,
    webKitFp: webKitFp6.footprintMb,
    totalFp: totalFp6,
    tauriCpu: tauriTop6.cpu,
    webKitCpu: webKitTop6.cpu,
    threads: tauriTop6.threads + webKitTop6.threads,
    expected: 'Bounded Memory, 0 leak',
  });
  console.log(`   ✅ Total Footprint: ${totalFp6} MB\n`);

  // ==========================================
  // Test 7: Post-Stress Idle Stabilization
  // ==========================================
  console.log('⏳ Running Test 7: Post-Stress Idle Stabilization (15s cooldown)...');
  await sleep(15000);
  const tauriFp7 = getFootprint(tauriPid);
  const webKitFp7 = getFootprint(webKitPid);
  const tauriTop7 = getTopStats(tauriPid);
  const webKitTop7 = getTopStats(webKitPid);
  const totalFp7 = tauriFp7.footprintMb + webKitFp7.footprintMb;

  results.push({
    scenario: 'Post-Stress Idle (Settled)',
    tauriFp: tauriFp7.footprintMb,
    webKitFp: webKitFp7.footprintMb,
    totalFp: totalFp7,
    tauriCpu: tauriTop7.cpu,
    webKitCpu: webKitTop7.cpu,
    threads: tauriTop7.threads + webKitTop7.threads,
    expected: 'CPU drops to ~0%, RAM remains plateaued',
  });
  console.log(`   ✅ Settle CPU: Tauri ${tauriTop7.cpu}%, WebKit ${webKitTop7.cpu}% | Total Footprint: ${totalFp7} MB\n`);

  console.log('📊 FINAL BENCHMARK SUMMARY TABLE:');
  console.table(results);

  fs.writeFileSync(
    'benchmark_production_results.json',
    JSON.stringify({ tauriPid, webKitPid, results }, null, 2),
    'utf8'
  );

  console.log('💾 Results saved to benchmark_production_results.json');
}

runBenchmarks().catch(console.error);
