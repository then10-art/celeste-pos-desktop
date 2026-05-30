/**
 * fetch-webapp.mjs
 * Cross-platform Node.js script to download the latest webapp build from celestepos.live.
 * Replaces the bash script that used grep -oP (not available on Windows Git Bash).
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import https from 'https';
import http from 'http';

const BASE_URL = 'https://celestepos.live';
const WEBAPP_DIR = join(process.cwd(), 'webapp');
const ASSETS_DIR = join(WEBAPP_DIR, 'assets');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'CelestePOS-Builder/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFile(url, destPath) {
  try {
    const { status, body } = await fetch(url);
    if (status === 200 && body.length > 0) {
      writeFileSync(destPath, body);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function extractAssetRefs(html) {
  // Match src="/assets/..." and href="/assets/..."
  const regex = /(?:src|href)="(\/assets\/[^"]+)"/g;
  const refs = new Set();
  let match;
  while ((match = regex.exec(html)) !== null) {
    refs.add(match[1]);
  }
  return [...refs];
}

function extractChunkRefs(jsContent) {
  // Match patterns like: "ChunkName-HashValue.js" or "ChunkName-HashValue.css"
  // Vite chunk naming: word chars, dash, word chars, dot, extension
  const regex = /["']?([A-Za-z0-9_][A-Za-z0-9_]*-[A-Za-z0-9_]+\.(js|css))["']?/g;
  const refs = new Set();
  let match;
  while ((match = regex.exec(jsContent)) !== null) {
    const filename = match[1];
    // Filter out false positives (too short, common non-chunk patterns)
    if (filename.length > 5 && !filename.startsWith('http') && !filename.includes('//')) {
      refs.add(filename);
    }
  }
  return [...refs];
}

async function main() {
  console.log('=== Fetching latest webapp from celestepos.live ===');

  // Ensure directories exist
  mkdirSync(ASSETS_DIR, { recursive: true });

  // 1. Download index.html
  const indexOk = await downloadFile(`${BASE_URL}/index.html`, join(WEBAPP_DIR, 'index.html'));
  if (!indexOk) {
    console.error('ERROR: Failed to download index.html');
    process.exit(1);
  }
  console.log('Downloaded index.html');

  // 2. Download manifest.json (optional)
  await downloadFile(`${BASE_URL}/manifest.json`, join(WEBAPP_DIR, 'manifest.json'));
  console.log('Downloaded manifest.json');

  // 3. Extract and download assets referenced in index.html
  const indexHtml = readFileSync(join(WEBAPP_DIR, 'index.html'), 'utf-8');
  const assetRefs = extractAssetRefs(indexHtml);
  console.log(`Found ${assetRefs.length} asset references in index.html`);

  for (const assetPath of assetRefs) {
    const destPath = join(WEBAPP_DIR, assetPath.replace(/^\//, ''));
    mkdirSync(join(destPath, '..'), { recursive: true });
    await downloadFile(`${BASE_URL}${assetPath}`, destPath);
    console.log(`  Downloaded ${assetPath}`);
  }

  // 4. Find main JS bundle and scan for lazy-loaded chunks
  const files = existsSync(ASSETS_DIR) ? readdirSync(ASSETS_DIR) : [];
  const mainJs = files.find(f => f.startsWith('index-') && f.endsWith('.js'));

  if (mainJs) {
    console.log(`Scanning ${mainJs} for lazy-loaded chunks...`);
    const mainContent = readFileSync(join(ASSETS_DIR, mainJs), 'utf-8');
    const chunks = extractChunkRefs(mainContent);
    console.log(`Found ${chunks.length} potential chunk references`);

    let downloadedCount = 0;
    for (const chunk of chunks) {
      const destPath = join(ASSETS_DIR, chunk);
      if (!existsSync(destPath)) {
        const ok = await downloadFile(`${BASE_URL}/assets/${chunk}`, destPath);
        if (ok) downloadedCount++;
      }
    }
    console.log(`Downloaded ${downloadedCount} lazy-loaded chunks`);

    // 5. Nested scan: scan all downloaded JS files for additional chunk references
    console.log('Starting nested chunk scan...');
    const allJsFiles = readdirSync(ASSETS_DIR).filter(f => f.endsWith('.js'));
    let nestedCount = 0;
    for (const jsFile of allJsFiles) {
      const content = readFileSync(join(ASSETS_DIR, jsFile), 'utf-8');
      const nestedRefs = extractChunkRefs(content);
      for (const ref of nestedRefs) {
        const destPath = join(ASSETS_DIR, ref);
        if (!existsSync(destPath)) {
          const ok = await downloadFile(`${BASE_URL}/assets/${ref}`, destPath);
          if (ok) nestedCount++;
        }
      }
    }
    console.log(`Downloaded ${nestedCount} additional nested chunks`);
  }

  // 6. Post-process index.html
  let html = readFileSync(join(WEBAPP_DIR, 'index.html'), 'utf-8');

  // Disable service worker
  html = html.replace(
    /if\s*\(\s*['"]serviceWorker['"]\s*in\s*navigator\s*\)/g,
    "if (false && 'serviceWorker' in navigator)"
  );

  // Remove debug collector and analytics
  html = html.split('\n').filter(line => {
    if (line.includes('__manus__/debug-collector')) return false;
    if (line.includes('manus-analytics')) return false;
    if (line.includes('data-website-id')) return false;
    return true;
  }).join('\n');

  writeFileSync(join(WEBAPP_DIR, 'index.html'), html);

  // 7. Final report
  const finalFiles = readdirSync(ASSETS_DIR);
  console.log(`\n=== Webapp fetch complete ===`);
  console.log(`Total files in webapp/assets/: ${finalFiles.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
