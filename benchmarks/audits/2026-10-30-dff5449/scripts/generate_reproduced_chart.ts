import * as fs from 'fs';
import * as path from 'path';

const AUDIT_DIR = path.resolve(process.cwd(), 'benchmarks/audits/2026-10-30-dff5449');
const CHARTS_DIR = path.join(AUDIT_DIR, 'charts');
const RAW_DIR = path.join(AUDIT_DIR, 'raw');

function generateReproducedChart() {
  const runs = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'reproduction_endurance_results.json'), 'utf8'));

  // 14 timepoints: m0, m200, m400, m600, m800, m1000, m1200, m1400, m1600, m1800, m2000, cd10, cd30, cd60
  const labels = ['0', '200', '400', '600', '800', '1k', '1.2k', '1.4k', '1.6k', '1.8k', '2k', '+10s', '+30s', '+60s'];

  const getPoints = (runIdx: number) => {
    const run = runs[runIdx];
    return run.samples.map((s: any, i: number) => {
      const x = 70 + (i / 13) * 600;
      const y = 300 - (s.totalFootprintMb / 1200) * 240;
      return `${x},${y}`;
    }).join(' ');
  };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 740 380" width="100%" height="100%" style="background:#0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <rect width="100%" height="100%" fill="#0d1117" rx="8"/>
  <text x="370" y="32" fill="#f0f6fc" font-size="17" font-weight="600" text-anchor="middle">Reproduced 2,000-Switch Memory Trajectory (Complete Time Series)</text>
  <text x="370" y="50" fill="#8b949e" font-size="11" text-anchor="middle">Full Physical Footprint (Native + WebKit) across 2,000 Ops and 60s Cooldown</text>

  <!-- Y Grid -->
  <line x1="70" y1="60" x2="690" y2="60" stroke="#30363d" stroke-dasharray="4"/>
  <text x="60" y="65" fill="#8b949e" font-size="10" text-anchor="end">1200 MB</text>

  <line x1="70" y1="120" x2="690" y2="120" stroke="#30363d" stroke-dasharray="4"/>
  <text x="60" y="125" fill="#8b949e" font-size="10" text-anchor="end">900 MB</text>

  <line x1="70" y1="180" x2="690" y2="180" stroke="#30363d" stroke-dasharray="4"/>
  <text x="60" y="185" fill="#8b949e" font-size="10" text-anchor="end">600 MB</text>

  <line x1="70" y1="240" x2="690" y2="240" stroke="#30363d" stroke-dasharray="4"/>
  <text x="60" y="245" fill="#8b949e" font-size="10" text-anchor="end">300 MB</text>

  <line x1="70" y1="300" x2="690" y2="300" stroke="#8b949e"/>
  <text x="60" y="305" fill="#8b949e" font-size="10" text-anchor="end">0 MB</text>

  <!-- Cooldown divider line -->
  <line x1="${70 + (10 / 13) * 600}" y1="60" x2="${70 + (10 / 13) * 600}" y2="300" stroke="#f85149" stroke-dasharray="2" stroke-width="1.5"/>
  <text x="${70 + (10 / 13) * 600 + 5}" y="75" fill="#f85149" font-size="10">End of Workload (Cooldown begins)</text>

  <!-- X Labels -->
  ${labels.map((l, i) => `<text x="${70 + (i / 13) * 600}" y="320" fill="#8b949e" font-size="10" text-anchor="middle">${l}</text>`).join('')}
  <text x="370" y="338" fill="#8b949e" font-size="11" text-anchor="middle">Operations Completed &amp; Post-Workload Cooldown Intervals</text>

  <!-- Run Lines -->
  <polyline fill="none" stroke="#58a6ff" stroke-width="2.5" points="${getPoints(0)}"/>
  <polyline fill="none" stroke="#bc8cff" stroke-width="2.5" points="${getPoints(1)}"/>
  <polyline fill="none" stroke="#e3b341" stroke-width="2.5" points="${getPoints(2)}"/>

  <!-- Legend -->
  <line x1="130" y1="360" x2="160" y2="360" stroke="#58a6ff" stroke-width="2.5"/>
  <text x="165" y="364" fill="#c9d1d9" font-size="11">Run 1: Peak 924 MB (at +10s) | Settled: 327 MB</text>

  <line x1="430" y1="360" x2="460" y2="360" stroke="#bc8cff" stroke-width="2.5"/>
  <text x="465" y="364" fill="#c9d1d9" font-size="11">Run 2: Peak 1025 MB (at +30s) | Settled: 1002 MB</text>
</svg>`;

  fs.writeFileSync(path.join(CHARTS_DIR, 'reproduced_endurance_memory.svg'), svg, 'utf8');
  console.log('Reproduced chart written to', path.join(CHARTS_DIR, 'reproduced_endurance_memory.svg'));
}

generateReproducedChart();

