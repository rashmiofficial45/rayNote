import { execSync } from 'child_process';
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

async function findPids() {
  for (let attempt = 0; attempt < 25; attempt++) {
    const tauriOut = sh("pgrep -f 'rayNote.app/Contents/MacOS/raynote'");
    const tauriPids = tauriOut.split('\n').filter(Boolean).map((p) => parseInt(p.trim(), 10));
    const tauriPid = tauriPids[0] || null;

    let webKitPid = null;
    const webKitPids = sh("pgrep -f 'com.apple.WebKit.WebContent'").split('\n').filter(Boolean);
    for (const pidStr of webKitPids) {
      const pid = parseInt(pidStr.trim(), 10);
      const openFiles = sh(`lsof -p ${pid} 2>/dev/null | grep 'com.raynote.desktop'`);
      if (openFiles.length > 0) {
        webKitPid = pid;
        break;
      }
    }

    if (tauriPid && webKitPid) {
      return { tauriPid, webKitPid };
    }
    await sleep(400);
  }
  return { tauriPid: null, webKitPid: null };
}

function getFootprint(pid) {
  if (!pid) return { footprintMb: 0, peakMb: 0, dirtyMb: 0, raw: '' };
  const out = sh(`footprint ${pid} 2>/dev/null`);
  let footprintMb = 0;
  let peakMb = 0;
  let dirtyMb = 0;

  const fpMatch = out.match(/Footprint:\s*(\d+)\s*MB/i);
  if (fpMatch) footprintMb = parseInt(fpMatch[1], 10);

  const peakMatch = out.match(/phys_footprint_peak:\s*(\d+)\s*MB/i);
  if (peakMatch) peakMb = parseInt(peakMatch[1], 10);

  const dirtyMatch = out.match(/TOTAL\s*\n\s*(\d+)\s*MB/i);
  if (dirtyMatch) dirtyMb = parseInt(dirtyMatch[1], 10);

  return { footprintMb, peakMb, dirtyMb, raw: out };
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

function typeStringIntoActiveEditor(text) {
  sh(`osascript -e 'tell application "System Events" to tell process "raynote" to set frontmost to true' -e 'tell application "System Events" to tell process "raynote" to keystroke "${text}"'`);
}

async function runEnduranceBenchmark() {
  console.log('🔬 Starting rayNote Ultra-High Endurance & Autosave Stress Benchmark...\n');

  // Step 1: Clean Restart for Accurate Zero-Base Measurement
  console.log('🔄 Restarting rayNote for clean baseline...');
  sh('pkill -f raynote || true');
  await sleep(1500);
  sh('open "/Users/rashmipersonal/Desktop/MAC Apps/rayNote/src-tauri/target/release/bundle/macos/rayNote.app"');
  let { tauriPid, webKitPid } = await findPids();
  console.log(`📍 Targets Identified:`);
  console.log(`   - rayNote Native Process (Tauri):  PID ${tauriPid}`);
  console.log(`   - WebKit WebContent Renderer:     PID ${webKitPid}\n`);

  const results = [];

  function recordSnapshot(scenario, expectedNotes = '') {
    const tauriFp = getFootprint(tauriPid);
    const webKitFp = getFootprint(webKitPid);
    const tauriTop = getTopStats(tauriPid);
    const webKitTop = getTopStats(webKitPid);
    const totalFp = tauriFp.footprintMb + webKitFp.footprintMb;
    const totalPeak = tauriFp.peakMb + webKitFp.peakMb;

    const row = {
      scenario,
      tauriFp: tauriFp.footprintMb,
      webKitFp: webKitFp.footprintMb,
      totalFp,
      totalPeak,
      tauriCpu: tauriTop.cpu,
      webKitCpu: webKitTop.cpu,
      threads: tauriTop.threads + webKitTop.threads,
      expected: expectedNotes,
    };
    results.push(row);
    console.log(`📊 [${scenario}] -> Total Footprint: ${totalFp} MB (Tauri: ${tauriFp.footprintMb} MB, WebKit: ${webKitFp.footprintMb} MB) | CPU: Tauri ${tauriTop.cpu}%, WebKit ${webKitTop.cpu}%`);
    return row;
  }

  // Phase 1: Fresh Baseline & Idle
  console.log('\n--- PHASE 1: Baseline & Idle Verification ---');
  recordSnapshot('1. Fresh Launch Baseline', 'Expected baseline ~150-200 MB');
  console.log('Sleeping 10s for initial idle stabilization...');
  await sleep(10000);
  recordSnapshot('2. Initial Idle (Settled)', 'CPU ~0.2%, memory stable');

  // Phase 2: High-Volume Switching Endurance
  console.log('\n--- PHASE 2: Ultra-High Volume Note Switching (1,000 Switches) ---');
  
  // 100 switches
  console.log('Cycling 100 note switches...');
  for (let i = 0; i < 100; i++) {
    switchNextNote();
    await sleep(60);
  }
  await sleep(1500);
  recordSnapshot('3. 100 Note Switches', 'Stable, plateau beginning');

  // 500 switches cumulative (400 more)
  console.log('Cycling to 500 cumulative note switches (+400)...');
  for (let i = 0; i < 400; i++) {
    switchNextNote();
    await sleep(60);
  }
  await sleep(2000);
  recordSnapshot('4. 500 Note Switches', 'Memory strictly bounded by LRU');

  // 1,000 switches cumulative (500 more)
  console.log('Cycling to 1,000 cumulative note switches (+500)...');
  for (let i = 0; i < 500; i++) {
    switchNextNote();
    await sleep(60);
  }
  await sleep(2500);
  recordSnapshot('5. 1,000 Note Switches', 'Memory plateaued (< 20 MB drift)');

  // Post-1000 switch idle cooldown
  console.log('Entering 15s post-1,000 switch cooldown...');
  await sleep(15000);
  recordSnapshot('6. Post-1,000 Switch Idle', 'CPU drops to ~0.2%, GC completes');

  // Phase 3: Giant Note Edit + Autosave + 100 Switches + Return
  console.log('\n--- PHASE 3: Giant Note Edit + Autosave + 100 Switches + Return ---');
  // Navigate to Giant Note 1 (it is in the list)
  console.log('Opening Giant Note (1 MB document)...');
  switchNextNote();
  await sleep(800);
  recordSnapshot('7. Giant 1 MB Note Loaded', 'Render single large document');

  // Type an edit into the giant note
  console.log('Injecting edit into active document...');
  typeStringIntoActiveEditor(' [STRESS_TEST_MODIFIED]');
  // Wait 1.5 seconds for debounced autosave (800ms) + SQLite write to commit
  await sleep(1500);
  recordSnapshot('8. Giant Note Edited & Autosaved', 'Cache updated in-place + DB flush');

  // Switch away 100 times
  console.log('Rapidly switching away 100 times through other notes...');
  for (let i = 0; i < 100; i++) {
    switchNextNote();
    await sleep(60);
  }
  await sleep(1500);
  recordSnapshot('9. 100 Switches Away', 'Document evicted to DB if needed');

  // Return to the edited note (cycle until back or navigate)
  console.log('Cycling back to original notes...');
  for (let i = 0; i < 25; i++) {
    switchNextNote();
    await sleep(60);
  }
  await sleep(2000);
  recordSnapshot('10. Returned to Giant Note', 'Restored from cache/DB with edits intact');

  // Final 15s Cooldown Idle
  console.log('Final 15s cooldown to verify system idle return...');
  await sleep(15000);
  recordSnapshot('11. Final Idle Stabilization', 'Final resting footprint & ~0% CPU');

  console.log('\n======================================================');
  console.log('🎉 ULTRA-ENDURANCE BENCHMARK SUMMARY TABLE:');
  console.log('======================================================');
  console.table(results);

  fs.writeFileSync(
    'stress_endurance_results.json',
    JSON.stringify({ tauriPid, webKitPid, results }, null, 2),
    'utf8'
  );
  console.log('💾 Results saved to stress_endurance_results.json');
}

runEnduranceBenchmark().catch(console.error);
