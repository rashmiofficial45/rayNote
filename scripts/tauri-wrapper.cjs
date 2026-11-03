#!/usr/bin/env node

/**
 * tauri-wrapper.cjs
 * Wraps @tauri-apps/cli to ensure macOS DMG bundles are created with the
 * high-DPI Retina custom onboarding layout using dmgbuild, bypassing AppleScript Finder limitations.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

const isBuild = args[0] === 'build';

if (!isBuild) {
  // Pass-through directly to Tauri CLI
  const tauriCliBin = path.join(rootDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const res = spawnSync(process.execPath, [tauriCliBin, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(res.status ?? 0);
}

// It's a `build` command!
let target = null;
let bundlesArgIndex = -1;
let bundlesValue = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target' && i + 1 < args.length) {
    target = args[i + 1];
  } else if (args[i].startsWith('--target=')) {
    target = args[i].split('=')[1];
  }

  if (args[i] === '--bundles' && i + 1 < args.length) {
    bundlesArgIndex = i;
    bundlesValue = args[i + 1];
  } else if (args[i].startsWith('--bundles=')) {
    bundlesArgIndex = i;
    bundlesValue = args[i].split('=')[1];
  }
}

const wantsDmg = !bundlesValue || bundlesValue.includes('dmg');

// Force Tauri to ONLY build 'app' bundle so it never runs its legacy create-dmg script
const tauriArgs = [...args];
if (bundlesArgIndex !== -1) {
  const list = bundlesValue.split(',').filter(b => b !== 'dmg');
  if (wantsDmg && !list.includes('app')) list.push('app');
  if (args[bundlesArgIndex].startsWith('--bundles=')) {
    tauriArgs[bundlesArgIndex] = `--bundles=${list.join(',')}`;
  } else {
    tauriArgs[bundlesArgIndex + 1] = list.join(',');
  }
} else {
  // Keep the existing default: native app first, custom DMG afterwards.
  tauriArgs.push('--bundles', 'app');
}

const tauriCliBin = path.join(rootDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
console.log(`\n🚀 [rayNote Build Hook] Running Tauri build (${tauriArgs.join(' ')})...`);

const buildRes = spawnSync(process.execPath, [tauriCliBin, ...tauriArgs], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

if (buildRes.status !== 0) {
  process.exit(buildRes.status ?? 1);
}

if (wantsDmg) {
  console.log('\n🎨 [rayNote Build Hook] Generating stylized high-DPI Retina DMG with custom onboarding window...');
  const packageDmgScript = path.join(rootDir, 'scripts', 'package-dmg.sh');
  const dmgArgs = target ? ['--target', target] : [];
  
  const dmgRes = spawnSync('bash', [packageDmgScript, ...dmgArgs], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (dmgRes.status !== 0) {
    console.error('❌ Failed to package stylized DMG.');
    process.exit(dmgRes.status ?? 1);
  }
}
