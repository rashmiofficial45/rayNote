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

function getCpu(pid) {
  if (!pid) return 0;
  const out = sh(`top -pid ${pid} -stats pid,cpu -l 2 -s 1 | tail -n 1`);
  const parts = out.trim().split(/\s+/);
  return parseFloat(parts[1]) || 0;
}

function switchDown() {
  sh(`osascript -e 'tell application "System Events" to tell process "raynote" to key code 125 using {option down}'`);
}

function switchUp() {
  sh(`osascript -e 'tell application "System Events" to tell process "raynote" to key code 126 using {option down}'`);
}

// Navigates to note at 0-indexed position from top
function navigateToTopNote(targetIndex) {
  // Go all the way to top first
  sh(`osascript -e 'tell application "System Events" to repeat 30 times' -e 'tell process "raynote" to key code 126 using {option down}' -e 'delay 0.02' -e 'end repeat'`);
  // Move down to targetIndex
  if (targetIndex > 0) {
    sh(`osascript -e 'tell application "System Events" to repeat ${targetIndex} times' -e 'tell process "raynote" to key code 125 using {option down}' -e 'delay 0.05' -e 'end repeat'`);
  }
}

async function runSingleIsolationTest(testName, startIndex, description) {
  console.log(`\n======================================================`);
  console.log(`🔬 Running Isolation: ${testName}`);
  console.log(`📝 Description: ${description}`);
  console.log(`======================================================`);

  sh('pkill -f raynote || true');
  await sleep(1500);
  sh('open "/Users/rashmipersonal/Desktop/MAC Apps/rayNote/src-tauri/target/release/bundle/macos/rayNote.app"');
  
  const { tauriPid, webKitPid } = await findPids();
  console.log(`PIDs -> Tauri: ${tauriPid}, WebKit: ${webKitPid}`);

  await sleep(6000); // Wait for initial boot and idle settling

  // Navigate to the target pair (startIndex and startIndex + 1)
  navigateToTopNote(startIndex);
  await sleep(1000);

  const baseTauri = getFootprint(tauriPid);
  const baseWebKit = getFootprint(webKitPid);
  console.log(`Initial Baseline: Total ${baseTauri + baseWebKit} MB (Tauri: ${baseTauri} MB, WebKit: ${baseWebKit} MB)`);

  let peakWebKit = baseWebKit;

  console.log(`Cycling 100 switches between note pair (Index ${startIndex} <-> ${startIndex + 1})...`);
  for (let i = 0; i < 100; i++) {
    if (i % 2 === 0) {
      switchDown(); // To note B
    } else {
      switchUp(); // To note A
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
  const idleCpu = getCpu(webKitPid);

  console.log(`\nResults for ${testName}:`);
  console.log(`   Baseline WebKit:  ${baseWebKit} MB`);
  console.log(`   Peak WebKit:      ${peakWebKit} MB`);
  console.log(`   Settled WebKit:   ${settledWebKit} MB (Total Process: ${settledTotal} MB)`);
  console.log(`   Settled Tauri:    ${settledTauri} MB`);
  console.log(`   Idle CPU:         ${idleCpu}%`);

  return {
    test: testName,
    description,
    baseWebKit,
    peakWebKit,
    settledWebKit,
    settledTotal,
    settledTauri,
    idleCpu,
  };
}

async function main() {
  console.log('🚀 Starting DOM Element Isolation Benchmarks on rayNote...');

  // Index 0 & 1: Plain 1 MB
  const t1 = await runSingleIsolationTest(
    'Test 1: Plain 1 MB (0 Code, 0 Tables)',
    0,
    'Pure markdown prose & headings only. Zero code blocks, zero tables.'
  );

  // Index 2 & 3: Code-Heavy 1 MB
  const t2 = await runSingleIsolationTest(
    'Test 2: Code-Heavy 1 MB (968 Code, 0 Tables)',
    2,
    '968 React CodeBlock NodeViews. Zero tables.'
  );

  // Index 4 & 5: Table-Heavy 1 MB
  const t3 = await runSingleIsolationTest(
    'Test 3: Table-Heavy 1 MB (0 Code, 581 Tables)',
    4,
    '581 Table DOM nodes and plugins. Zero code blocks.'
  );

  // Index 6 & 7: Realistic 1 MB
  const t4 = await runSingleIsolationTest(
    'Test 4: Realistic 1 MB (10 Code, 5 Tables)',
    6,
    'Realistic knowledge base document: 10 code blocks, 5 tables, headings & markdown prose.'
  );

  console.log('\n========================================================================');
  console.log('📊 DOM ISOLATION EXPERIMENT SUMMARY MATRIX:');
  console.log('========================================================================');
  console.table([t1, t2, t3, t4]);

  fs.writeFileSync(
    'isolation_experiment_results.json',
    JSON.stringify([t1, t2, t3, t4], null, 2),
    'utf8'
  );
  console.log('💾 Results saved to isolation_experiment_results.json');
}

main().catch(console.error);
