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

function navigateToTopNote(targetIndex) {
  sh(`osascript -e 'tell application "System Events" to repeat 30 times' -e 'tell process "raynote" to key code 126 using {option down}' -e 'delay 0.02' -e 'end repeat'`);
  if (targetIndex > 0) {
    sh(`osascript -e 'tell application "System Events" to repeat ${targetIndex} times' -e 'tell process "raynote" to key code 125 using {option down}' -e 'delay 0.05' -e 'end repeat'`);
  }
}

async function runNativeCodeBlockTest() {
  console.log(`\n======================================================`);
  console.log(`🔬 Running Configuration B: Native ProseMirror <pre><code>`);
  console.log(`📝 Document: 1 MB Code-Heavy Note (968 Code Blocks, 0 Tables)`);
  console.log(`======================================================`);

  sh('pkill -f raynote || true');
  await sleep(1500);
  sh('open "/Users/rashmipersonal/Desktop/MAC Apps/rayNote/src-tauri/target/release/bundle/macos/rayNote.app"');

  const { tauriPid, webKitPid } = await findPids();
  console.log(`PIDs -> Tauri: ${tauriPid}, WebKit: ${webKitPid}`);

  await sleep(6000); // Wait for initial boot and idle settling

  // Index 2 is iso-code-1
  navigateToTopNote(2);
  await sleep(1000);

  const baseTauri = getFootprint(tauriPid);
  const baseWebKit = getFootprint(webKitPid);
  console.log(`Initial Baseline: Total ${baseTauri + baseWebKit} MB (Tauri: ${baseTauri} MB, WebKit: ${baseWebKit} MB)`);

  let peakWebKit = baseWebKit;

  console.log(`Cycling 100 switches between 1 MB code notes (Index 2 <-> 3)...`);
  for (let i = 0; i < 100; i++) {
    if (i % 2 === 0) {
      switchDown();
    } else {
      switchUp();
    }
    await sleep(75);

    if (i % 20 === 0 || i === 99) {
      const curWebKit = getFootprint(webKitPid);
      if (curWebKit > peakWebKit) peakWebKit = curWebKit;
      console.log(`   Switch #${i + 1} -> WebKit Footprint: ${curWebKit} MB`);
    }
  }

  console.log(`Waiting 15 seconds for initial settling...`);
  await sleep(15000);

  const settled15sTauri = getFootprint(tauriPid);
  const settled15sWebKit = getFootprint(webKitPid);

  console.log(`Waiting another 20 seconds for full GC / idle settling...`);
  await sleep(20000);

  const finalTauri = getFootprint(tauriPid);
  const finalWebKit = getFootprint(webKitPid);
  const finalTotal = finalTauri + finalWebKit;
  const idleCpu = getCpu(webKitPid);

  console.log(`\nResults for Native CodeBlock Configuration B:`);
  console.log(`   Baseline WebKit:         ${baseWebKit} MB`);
  console.log(`   Peak WebKit:             ${peakWebKit} MB`);
  console.log(`   Settled (15s) WebKit:    ${settled15sWebKit} MB`);
  console.log(`   Final Settled WebKit:    ${finalWebKit} MB (Total: ${finalTotal} MB)`);
  console.log(`   Settled Tauri:           ${finalTauri} MB`);
  console.log(`   Idle CPU:                ${idleCpu}%`);

  const result = {
    test: 'Configuration B: Native ProseMirror <pre><code>',
    baseWebKit,
    peakWebKit,
    settled15sWebKit,
    finalWebKit,
    finalTotal,
    finalTauri,
    idleCpu,
  };

  fs.writeFileSync('native_codeblock_ab_result.json', JSON.stringify(result, null, 2), 'utf8');
}

runNativeCodeBlockTest().catch(console.error);
