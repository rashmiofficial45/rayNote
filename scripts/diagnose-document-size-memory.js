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
  if (!pid) return 0;
  const out = sh(`footprint ${pid} 2>/dev/null`);
  const match = out.match(/Footprint:\s*(\d+)\s*MB/i);
  return match ? parseInt(match[1], 10) : 0;
}

function switchNext() {
  sh(`osascript -e 'tell application "System Events" to tell process "raynote" to key code 125 using {option down}'`);
}

function switchPrev() {
  sh(`osascript -e 'tell application "System Events" to tell process "raynote" to key code 126 using {option down}'`);
}

async function runTest(label, isSmallOnly) {
  console.log(`\n======================================================`);
  console.log(`🔬 Running Diagnostic: ${label}`);
  console.log(`======================================================`);

  sh('pkill -f raynote || true');
  await sleep(1500);
  sh('open "/Users/rashmipersonal/Desktop/MAC Apps/rayNote/src-tauri/target/release/bundle/macos/rayNote.app"');
  const { tauriPid, webKitPid } = await findPids();
  console.log(`PIDs -> Tauri: ${tauriPid}, WebKit: ${webKitPid}`);

  await sleep(6000); // Wait for boot idle
  const baseTauri = getFootprint(tauriPid);
  const baseWebKit = getFootprint(webKitPid);
  console.log(`Initial Baseline: Total ${baseTauri + baseWebKit} MB (Tauri: ${baseTauri} MB, WebKit: ${baseWebKit} MB)`);

  let peakWebKit = baseWebKit;

  console.log(`Cycling 100 switches...`);
  // If small only, alternate between top notes (the 5 small notes are at the top of the list)
  for (let i = 0; i < 100; i++) {
    if (isSmallOnly) {
      // Bounce between small notes 0 to 4
      if (i % 8 < 4) switchNext();
      else switchPrev();
    } else {
      // Cycle through all notes including the 1 MB giants
      switchNext();
    }
    await sleep(75);

    if (i % 20 === 0 || i === 99) {
      const curWebKit = getFootprint(webKitPid);
      if (curWebKit > peakWebKit) peakWebKit = curWebKit;
      console.log(`   Switch #${i + 1} -> WebKit Footprint: ${curWebKit} MB`);
    }
  }

  console.log(`Waiting 15 seconds for idle settling / GC...`);
  await sleep(15000);

  const settledTauri = getFootprint(tauriPid);
  const settledWebKit = getFootprint(webKitPid);
  const settledTotal = settledTauri + settledWebKit;

  console.log(`\nResults for ${label}:`);
  console.log(`   Baseline WebKit:  ${baseWebKit} MB`);
  console.log(`   Peak WebKit:      ${peakWebKit} MB`);
  console.log(`   Settled WebKit:   ${settledWebKit} MB (Total Process: ${settledTotal} MB)`);
  console.log(`   Settled Tauri:    ${settledTauri} MB`);

  return {
    label,
    baseWebKit,
    peakWebKit,
    settledWebKit,
    settledTotal,
    settledTauri,
  };
}

async function main() {
  const smallResults = await runTest('100 Switches of 20 KB Notes', true);
  const giantResults = await runTest('100 Switches of Large/Giant Notes (up to 1 MB)', false);

  console.log('\n======================================================');
  console.log('📊 COMPARISON SUMMARY (20 KB vs 1 MB Notes):');
  console.log('======================================================');
  console.table([smallResults, giantResults]);

  fs.writeFileSync(
    'document_size_diagnostic_results.json',
    JSON.stringify({ smallResults, giantResults }, null, 2),
    'utf8'
  );
}

main().catch(console.error);
