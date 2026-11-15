// Bundles src/ into one self-contained HTML file: dist/index.html.
// Usage: node scripts/build.js             (full HTML document)
//        node scripts/build.js --fragment  (no doctype/html/body wrapper, for hosts that add their own)
//        node scripts/build.js --out=path  (write somewhere else)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fragment = process.argv.includes('--fragment');

const head = `<title>Halden CFO Control Center</title>
<meta name="description" content="One-page CFO dashboard for a fictional SaaS company: ARR, budget vs actual, runway, working capital, headcount and close KPIs. Synthetic data.">
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500..700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
${read('src/styles.css')}
</style>`;
// data/live/live.js is written by scripts/sync.js; it is bundled when present.
const files = ['src/data.js', 'src/engine.js', 'data/live/live.js', 'src/live.js', 'src/app.js'].filter((f) => fs.existsSync(path.join(root, f)));
const scripts = files.map((f) => `<script>\n${read(f)}\n</script>`).join('\n');
const body = `${read('src/body.html')}\n${scripts}`;

const out = fragment
  ? `${head}\n${body}\n`
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
const target = process.argv.find((a) => a.startsWith('--out='));
const file = target ? target.slice(6) : path.join(root, 'dist', fragment ? 'fragment.html' : 'index.html');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out);
console.log('Wrote', file, (out.length / 1024).toFixed(1) + ' KB');
