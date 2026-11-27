#!/usr/bin/env node
/**
 * Writes browser-rendered sample screenshots with REAL text for the data-first checks of the Two Screen Comparison
 * tab to public/test-screenshots/data/. Fictional data only. Each DEV file is one acceptance case against prod.png.
 * The PNGs are committed so unit tests need no browser; re-run after changing the template:
 *   node scripts/make-data-screenshots.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');

const out = path.join(__dirname, '..', 'public', 'test-screenshots', 'data');

const ROWS = [
  { inv: 'INV-101', cust: 'Acme Corp', status: 'Approved', amount: '$4,200.00', date: '2026-11-02' },
  { inv: 'INV-102', cust: 'Globex Ltd', status: 'Approved', amount: '$1,150.50', date: '2026-11-05' },
  { inv: 'INV-103', cust: 'Initech', status: 'Pending', amount: '$980.00', date: '2026-11-09' },
  { inv: 'INV-104', cust: 'Umbrella Inc', status: 'Rejected', amount: '$2,640.00', date: '2026-11-14' },
  { inv: 'INV-105', cust: 'Stark Supply', status: 'Approved', amount: '$7,325.25', date: '2026-11-21' },
];

function page(o = {}) {
  const c = {
    users: '1,248', revenue: '$12,500.00', conversion: '3.4%', updated: '10:42 AM', rows: ROWS,
    primary: '#2563eb', font: 'Arial, Helvetica, sans-serif', weight: 400, chart: true, checked: true, addEnabled: true, ...o,
  };
  const bars = [40, 65, 52, 80, 71, 90];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;font-family:${c.font};font-weight:${c.weight};color:#111827;background:#fff;font-size:15px}
  header{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;background:${c.primary};color:#fff}
  header h1{margin:0;font-size:22px} main{padding:18px 24px}
  .cards{display:flex;gap:16px} .card{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:12px 16px}
  .card .k{color:#4b5563;font-size:14px} .card .v{font-size:24px;font-weight:700;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:18px} th,td{border-bottom:1px solid #e5e7eb;padding:8px 10px;text-align:left}
  th{background:#f3f4f6;font-size:14px} .row2{display:flex;gap:24px;margin-top:18px;align-items:flex-start}
  .chart{width:420px;height:170px;border:1px solid #d1d5db;border-radius:8px;padding:8px}
  .form{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:14px} button{border:0;border-radius:6px;padding:8px 16px;font-size:15px;color:#fff}
  </style></head><body>
  <header><h1>Billing Dashboard</h1><div>Last updated: ${c.updated}</div></header>
  <main>
    <div class="cards">
      <div class="card"><div class="k">Active Users</div><div class="v">${c.users}</div></div>
      <div class="card"><div class="k">Revenue</div><div class="v">${c.revenue}</div></div>
      <div class="card"><div class="k">Conversion</div><div class="v">${c.conversion}</div></div>
    </div>
    <table><thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead><tbody>
    ${c.rows.map((r) => `<tr><td>${r.inv}</td><td>${r.cust}</td><td>${r.status}</td><td>${r.amount}</td><td>${r.date}</td></tr>`).join('')}
    </tbody></table>
    <div class="row2">
      <div class="chart">${c.chart ? `<svg width="400" height="150" viewBox="0 0 400 150">
        ${bars.map((h, i) => `<rect x="${20 + i * 62}" y="${130 - h}" width="38" height="${h}" fill="${i % 2 ? '#f59e0b' : '#10b981'}"/>`).join('')}
        <line x1="10" y1="130" x2="395" y2="130" stroke="#6b7280"/></svg>` : ''}</div>
      <div class="form">
        <label><input type="checkbox" ${c.checked ? 'checked' : ''}> Email alerts</label>
        <div style="margin-top:12px"><button style="background:${c.addEnabled ? c.primary : '#9ca3af'}" ${c.addEnabled ? '' : 'disabled'}>Add User</button></div>
      </div>
    </div>
  </main></body></html>`;
}

const changedRows = ROWS.map((r) =>
  r.inv === 'INV-102' ? { ...r, status: 'Pending' } : r.inv === 'INV-104' ? { ...r, inv: 'INV-106' } : r.inv === 'INV-105' ? { ...r, date: '2026-11-22' } : r
);

const CASES = {
  'prod.png': {},
  'dev-identical.png': {},
  'dev-data-changed.png': { users: '1,250', revenue: '$1,250.00', rows: changedRows },
  'dev-missing-row.png': { rows: ROWS.filter((r) => r.inv !== 'INV-103') },
  'dev-sorted.png': { rows: [...ROWS].reverse() },
  'dev-restyled.png': { primary: '#059669', font: 'Verdana, Geneva, sans-serif' },
  'dev-clock.png': { updated: '11:05 AM' },
  'dev-chart-missing.png': { chart: false },
  'dev-form-state.png': { checked: false, addEnabled: false },
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const shoot = async (html, scale = 1) => {
      const p = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: scale });
      await p.setContent(html);
      const buf = await p.screenshot();
      await p.close();
      return buf;
    };
    for (const [name, o] of Object.entries(CASES)) fs.writeFileSync(path.join(out, name), await shoot(page(o)));
    // same page at device pixel ratio 2 (different resolution, same data)
    fs.writeFileSync(path.join(out, 'dev-2x.png'), await shoot(page(), 2));
    // low quality: downscaled, blurred, heavy JPEG, with the amounts changed (values must not be invented)
    const lq = await shoot(page({ users: '1,250' }));
    const small = await sharp(lq).resize(420).blur(0.9).jpeg({ quality: 18 }).toBuffer();
    fs.writeFileSync(path.join(out, 'dev-lowquality.jpg'), await sharp(small).resize(1000).jpeg({ quality: 25 }).toBuffer());
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(out, 'README.md'),
    `# Data-first sample screenshots (fictional data)

Generated by \`node scripts/make-data-screenshots.js\` (headless Chromium). Use **prod.png** as PROD:

| DEV file | Expect (default scope: Data & Text) |
|---|---|
| dev-identical.png | No material differences |
| dev-data-changed.png | Active Users 1,248→1,250, Revenue $12,500.00→$1,250.00, INV-102 status Approved→Pending, INV-104→INV-106, INV-105 date changed |
| dev-missing-row.png | Record INV-103 missing in DEV |
| dev-sorted.png | No data mismatches (rows matched by invoice ID, not position) |
| dev-restyled.png | No data mismatches; with CSS & Visual Styling checked → color/typography findings |
| dev-clock.png | "Last updated" time changed; add ignore field \`Last updated\` → excluded and logged |
| dev-chart-missing.png | Nothing with the default scope; with Images & Diagrams → chart missing in DEV |
| dev-form-state.png | Nothing with the default scope; with Form Elements & States → checkbox/button state findings |
| dev-2x.png | Different resolution, same data → no data mismatches without choosing an alignment |
| dev-lowquality.jpg | Blurry: unreadable items flagged Uncertain / needs review, no invented values |
`
  );
  console.log(`Wrote ${Object.keys(CASES).length + 2} screenshots to ${out}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
