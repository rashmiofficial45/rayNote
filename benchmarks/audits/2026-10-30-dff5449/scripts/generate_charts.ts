import * as fs from 'fs';
import * as path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'benchmarks/audits/2026-10-30-dff5449');
const CHARTS_DIR = path.join(AUDIT_DIR, 'charts');
const RAW_DIR = path.join(AUDIT_DIR, 'raw');

// 1. Launch Latency Chart (Cold vs Warm)
function generateLaunchChart() {
  const data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'benchmark_a_launch.json'), 'utf8'));
  const cold = data.coldRuns.map((r: any) => r.latencyMs);
  const warm = data.warmRuns.map((r: any) => r.latencyMs);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 350" width="100%" height="100%" style="background:#0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <rect width="100%" height="100%" fill="#0d1117" rx="8"/>
  <text x="350" y="35" fill="#f0f6fc" font-size="18" font-weight="600" text-anchor="middle">Benchmark A: Launch Latency Comparison (Cold vs Warm)</text>
  <text x="350" y="55" fill="#8b949e" font-size="12" text-anchor="middle">5 Cold Launches vs 5 Warm Restarts (Apple M3 macOS 27.2)</text>

  <!-- Y Axis Grid -->
  <line x1="80" y1="80" x2="650" y2="80" stroke="#30363d" stroke-dasharray="4"/>
  <text x="70" y="85" fill="#8b949e" font-size="11" text-anchor="end">2000 ms</text>

  <line x1="80" y1="135" x2="650" y2="135" stroke="#30363d" stroke-dasharray="4"/>
  <text x="70" y="140" fill="#8b949e" font-size="11" text-anchor="end">1500 ms</text>

  <line x1="80" y1="190" x2="650" y2="190" stroke="#30363d" stroke-dasharray="4"/>
  <text x="70" y="195" fill="#8b949e" font-size="11" text-anchor="end">1000 ms</text>

  <line x1="80" y1="245" x2="650" y2="245" stroke="#30363d" stroke-dasharray="4"/>
  <text x="70" y="250" fill="#8b949e" font-size="11" text-anchor="end">500 ms</text>

  <line x1="80" y1="300" x2="650" y2="300" stroke="#8b949e"/>
  <text x="70" y="305" fill="#8b949e" font-size="11" text-anchor="end">0 ms</text>

  <!-- Bars for Cold Runs -->
  ${cold.map((val: number, i: number) => {
    const x = 110 + i * 50;
    const height = (val / 2000) * 220;
    const y = 300 - height;
    return `
      <rect x="${x}" y="${y}" width="32" height="${height}" fill="#f85149" rx="4"/>
      <text x="${x + 16}" y="${y - 6}" fill="#f85149" font-size="10" text-anchor="middle">${Math.round(val)}</text>
      <text x="${x + 16}" y="318" fill="#8b949e" font-size="11" text-anchor="middle">C${i + 1}</text>
    `;
  }).join('')}

  <!-- Bars for Warm Runs -->
  ${warm.map((val: number, i: number) => {
    const x = 390 + i * 50;
    const height = (val / 2000) * 220;
    const y = 300 - height;
    return `
      <rect x="${x}" y="${y}" width="32" height="${height}" fill="#2ea043" rx="4"/>
      <text x="${x + 16}" y="${y - 6}" fill="#2ea043" font-size="10" text-anchor="middle">${Math.round(val)}</text>
      <text x="${x + 16}" y="318" fill="#8b949e" font-size="11" text-anchor="middle">W${i + 1}</text>
    `;
  }).join('')}

  <!-- Legend -->
  <rect x="230" y="332" width="12" height="12" fill="#f85149" rx="2"/>
  <text x="250" y="342" fill="#c9d1d9" font-size="12">Cold Launches (First: 1,794ms, Median: 495ms)</text>
  <rect x="510" y="332" width="12" height="12" fill="#2ea043" rx="2"/>
  <text x="530" y="342" fill="#c9d1d9" font-size="12">Warm Launches (Median: 537ms)</text>
</svg>`;
  fs.writeFileSync(path.join(CHARTS_DIR, 'launch_latency.svg'), svg, 'utf8');
}

// 2. Endurance Memory Trajectory Chart (Run 1, 2, 3)
function generateEnduranceChart() {
  const data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'benchmark_c_endurance.json'), 'utf8'));
  const milestones = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000];

  const getPoints = (runIdx: number) => {
    const run = data.enduranceRuns[runIdx];
    return run.milestones.map((m: any, i: number) => {
      const x = 80 + (i / 10) * 560;
      const y = 300 - (m.totalFootprintMb / 900) * 240;
      return `${x},${y}`;
    }).join(' ');
  };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 370" width="100%" height="100%" style="background:#0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <rect width="100%" height="100%" fill="#0d1117" rx="8"/>
  <text x="360" y="35" fill="#f0f6fc" font-size="18" font-weight="600" text-anchor="middle">Benchmark C: 2,000-Switch Memory Trajectory (3 Independent Runs)</text>
  <text x="360" y="55" fill="#8b949e" font-size="12" text-anchor="middle">Physical Footprint (Native + WebKit) across 2,000 Operations</text>

  <!-- Y Grid -->
  <line x1="80" y1="60" x2="680" y2="60" stroke="#30363d" stroke-dasharray="4"/>
  <text x="70" y="65" fill="#8b949e" font-size="11" text-anchor="end">900 MB</text>

  <line x1="80" y1="120" x2="680" y2="120" stroke="#30363d" stroke-dasharray="4"/>
  <text x="70" y="125" fill="#8b949e" font-size="11" text-anchor="end">675 MB</text>

  <line x1="80" y1="180" x2="680" y2="180" stroke="#30363d" stroke-dasharray="4"/>
  <text x="70" y="185" fill="#8b949e" font-size="11" text-anchor="end">450 MB</text>

  <line x1="80" y1="240" x2="680" y2="240" stroke="#30363d" stroke-dasharray="4"/>
  <text x="70" y="245" fill="#8b949e" font-size="11" text-anchor="end">225 MB</text>

  <line x1="80" y1="300" x2="680" y2="300" stroke="#8b949e"/>
  <text x="70" y="305" fill="#8b949e" font-size="11" text-anchor="end">0 MB</text>

  <!-- X Labels -->
  ${milestones.map((m, i) => `<text x="${80 + (i / 10) * 560}" y="320" fill="#8b949e" font-size="10" text-anchor="middle">${m}</text>`).join('')}
  <text x="360" y="338" fill="#8b949e" font-size="11" text-anchor="middle">Operations Completed</text>

  <!-- Run Lines -->
  <polyline fill="none" stroke="#58a6ff" stroke-width="3" points="${getPoints(0)}"/>
  <polyline fill="none" stroke="#bc8cff" stroke-width="3" points="${getPoints(1)}"/>
  <polyline fill="none" stroke="#e3b341" stroke-width="3" points="${getPoints(2)}"/>

  <!-- Legend -->
  <line x1="160" y1="355" x2="190" y2="355" stroke="#58a6ff" stroke-width="3"/>
  <text x="195" y="359" fill="#c9d1d9" font-size="11">Run 1 (Peak: 845 MB)</text>
  <line x1="330" y1="355" x2="360" y2="355" stroke="#bc8cff" stroke-width="3"/>
  <text x="365" y="359" fill="#c9d1d9" font-size="11">Run 2 (Peak: 517 MB)</text>
  <line x1="500" y1="355" x2="530" y2="355" stroke="#e3b341" stroke-width="3"/>
  <text x="535" y="359" fill="#c9d1d9" font-size="11">Run 3 (Peak: 458 MB)</text>
</svg>`;
  fs.writeFileSync(path.join(CHARTS_DIR, 'endurance_memory.svg'), svg, 'utf8');
}

// 3. Database CRUD Operations Latency Chart
function generateCrudChart() {
  const data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'benchmark_e_crud.json'), 'utf8'));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 650 320" width="100%" height="100%" style="background:#0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <rect width="100%" height="100%" fill="#0d1117" rx="8"/>
  <text x="325" y="35" fill="#f0f6fc" font-size="18" font-weight="600" text-anchor="middle">Benchmark E: SQLite Operation Latencies</text>
  <text x="325" y="55" fill="#8b949e" font-size="12" text-anchor="middle">Per-Operation Latency across 500 Inserts, Updates, 200 Searches, 200 Deletes</text>

  <!-- Y Axis Grid -->
  <line x1="100" y1="80" x2="600" y2="80" stroke="#30363d" stroke-dasharray="4"/>
  <text x="90" y="85" fill="#8b949e" font-size="11" text-anchor="end">7.0 ms</text>

  <line x1="100" y1="135" x2="600" y2="135" stroke="#30363d" stroke-dasharray="4"/>
  <text x="90" y="140" fill="#8b949e" font-size="11" text-anchor="end">5.0 ms</text>

  <line x1="100" y1="190" x2="600" y2="190" stroke="#30363d" stroke-dasharray="4"/>
  <text x="90" y="195" fill="#8b949e" font-size="11" text-anchor="end">2.5 ms</text>

  <line x1="100" y1="245" x2="600" y2="245" stroke="#30363d" stroke-dasharray="4"/>
  <text x="90" y="250" fill="#8b949e" font-size="11" text-anchor="end">1.0 ms</text>

  <line x1="100" y1="270" x2="600" y2="270" stroke="#8b949e"/>
  <text x="90" y="275" fill="#8b949e" font-size="11" text-anchor="end">0.0 ms</text>

  <!-- Bars -->
  <!-- Insert -->
  <rect x="140" y="${270 - (data.avgCreateMs / 7.0) * 190}" width="60" height="${(data.avgCreateMs / 7.0) * 190}" fill="#2ea043" rx="4"/>
  <text x="170" y="${270 - (data.avgCreateMs / 7.0) * 190 - 8}" fill="#2ea043" font-size="11" text-anchor="middle">${data.avgCreateMs.toFixed(2)} ms</text>
  <text x="170" y="290" fill="#c9d1d9" font-size="12" text-anchor="middle">Insert (500)</text>

  <!-- Update -->
  <rect x="250" y="${270 - (data.avgUpdateMs / 7.0) * 190}" width="60" height="${(data.avgUpdateMs / 7.0) * 190}" fill="#388bfd" rx="4"/>
  <text x="280" y="${270 - (data.avgUpdateMs / 7.0) * 190 - 8}" fill="#388bfd" font-size="11" text-anchor="middle">${data.avgUpdateMs.toFixed(2)} ms</text>
  <text x="280" y="290" fill="#c9d1d9" font-size="12" text-anchor="middle">Update (500)</text>

  <!-- Search -->
  <rect x="360" y="${270 - (data.avgSearchMs / 7.0) * 190}" width="60" height="${(data.avgSearchMs / 7.0) * 190}" fill="#e3b341" rx="4"/>
  <text x="390" y="${270 - (data.avgSearchMs / 7.0) * 190 - 8}" fill="#e3b341" font-size="11" text-anchor="middle">${data.avgSearchMs.toFixed(2)} ms</text>
  <text x="390" y="290" fill="#c9d1d9" font-size="12" text-anchor="middle">FTS Search (200)</text>

  <!-- Delete -->
  <rect x="470" y="${270 - (data.avgDeleteMs / 7.0) * 190}" width="60" height="${(data.avgDeleteMs / 7.0) * 190}" fill="#f85149" rx="4"/>
  <text x="500" y="${270 - (data.avgDeleteMs / 7.0) * 190 - 8}" fill="#f85149" font-size="11" text-anchor="middle">${data.avgDeleteMs.toFixed(2)} ms</text>
  <text x="500" y="290" fill="#c9d1d9" font-size="12" text-anchor="middle">Delete (200)</text>
</svg>`;
  fs.writeFileSync(path.join(CHARTS_DIR, 'crud_latency.svg'), svg, 'utf8');
}

generateLaunchChart();
generateEnduranceChart();
generateCrudChart();
console.log('Charts generated successfully in', CHARTS_DIR);

