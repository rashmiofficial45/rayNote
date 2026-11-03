/// <reference types="node" />
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const temporaryRoots: string[] = [];
afterEach(() => { for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function runWrapper(args: string[]) {
  const child = vi.fn().mockReturnValue({ status: 0 });
  const code = readFileSync(path.join(projectRoot, 'scripts/tauri-wrapper.cjs'), 'utf8');
  vm.runInNewContext(code, {
    __dirname: path.join(projectRoot, 'scripts'),
    require: (name: string) => name === 'child_process' ? { spawnSync: child } : name === 'path' ? path : name === 'fs' ? {} : (() => { throw new Error(`Unexpected require ${name}`); })(),
    process: { argv: ['node', 'tauri-wrapper.cjs', ...args], execPath: '/mock/node', env: {} },
    console: { log: () => {}, error: () => {} },
  });
  return child.mock.calls;
}

/** Execute only the selection/naming prefix in an isolated synthetic repo.
 * No packaging body is copied; every build/install/copy/system command is a shell stub.
 */
function inspectPlan(throughNaming: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), 'raynote-packaging-plan-'));
  temporaryRoots.push(root);
  const scripts = path.join(root, 'scripts'); mkdirSync(scripts);
  mkdirSync(path.join(root, 'src-tauri/icons'), { recursive: true });
  writeFileSync(path.join(root, 'src-tauri/icons/dmg-background.png'), 'fixture');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.7.1' }));
  writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '2.7.1', productName: 'rayNote' }));
  writeFileSync(path.join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "2.7.1"\n');
  const expected = path.join(root, 'src-tauri/target/x86_64-apple-darwin/release/bundle/macos/rayNote.app');
  const competing = path.join(root, 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/rayNote.app');
  const generic = path.join(root, 'src-tauri/target/release/bundle/macos/rayNote.app');
  for (const bundle of [expected, competing, generic]) mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
  writeFileSync(path.join(root, 'src-tauri/target/release/raynote'), 'wrong generic architecture');
  utimesSync(expected, new Date('2025-01-01'), new Date('2025-01-01'));
  utimesSync(generic, new Date('2026-01-01'), new Date('2026-01-01'));
  utimesSync(competing, new Date('2027-01-01'), new Date('2027-01-01'));
  const code = readFileSync(path.join(projectRoot, 'scripts/package-dmg.sh'), 'utf8');
  const marker = throughNaming ? /^# 5\./m : /^# 3\./m;
  const cutoff = code.search(marker);
  if (cutoff < 0) throw new Error('Cannot locate safe planning boundary; refusing to execute package body');
  const stubs = `
cp() { printf 'MUTATION_COPY=%s\\n' "$*"; }
pnpm() { printf 'UNEXPECTED_BUILD=%s\\n' "$*"; return 98; }
swift() { return 98; }
dmgbuild() { return 98; }
pip3() { return 98; }
hdiutil() { return 0; }
diskutil() { return 0; }
rm() { return 0; }
`;
  const planFile = path.join(scripts, 'package-plan.sh');
  writeFileSync(planFile, stubs + code.slice(0, cutoff) + `\nprintf 'SELECTED_APP=%s\\nPLANNED_DMG=%s\\n' "$APP_SRC" "$PRIMARY_DMG"\n`);
  const result = spawnSync('/bin/bash', [planFile, '--target', 'x86_64-apple-darwin'], { encoding: 'utf8', env: { ...process.env, RAYNOTE_APP_PATH: '', HOME: root } });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toContain('UNEXPECTED_BUILD=');
  return { expected, stdout: result.stdout };
}

describe('Packaging audit regressions with mocked side effects', () => {
  it('rewrites equals-form --bundles=dmg without replacing the following target argument (B37)', () => {
    const calls = runWrapper(['build', '--bundles=dmg', '--target', 'x86_64-apple-darwin']);
    expect(calls[0][1].slice(1)).toEqual(['build', '--bundles=app', '--target', 'x86_64-apple-darwin']);
    expect(calls[1][1].slice(1)).toEqual(['--target', 'x86_64-apple-darwin']);
  });
  it('rewrites an equals-form bundle list without altering adjacent options (B37)', () => {
    const calls = runWrapper(['build', '--bundles=app,dmg', '--target=x86_64-apple-darwin']);
    expect(calls[0][1].slice(1)).toEqual(['build', '--bundles=app', '--target=x86_64-apple-darwin']);
  });
  it('preserves the default-build restriction to app introduced by the existing wrapper (B37)', () => {
    const calls = runWrapper(['build']);
    expect(calls[0][1].slice(1)).toEqual(['build', '--bundles', 'app']);
  });
  it('selects the exact requested architecture even when another bundle is newer (B38)', () => {
    const { expected, stdout } = inspectPlan(false);
    expect(stdout).toContain(`SELECTED_APP=${expected}\n`);
  });
  it('never mutates a selected app bundle using an unrelated generic binary (B38)', () => {
    expect(inspectPlan(false).stdout).not.toContain('MUTATION_COPY=');
  });
  it('names the planned installer using package version and requested architecture (B39)', () => {
    expect(inspectPlan(true).stdout).toMatch(/PLANNED_DMG=.*\/rayNote_2\.7\.1_x86_64\.dmg\n/);
  });
});
