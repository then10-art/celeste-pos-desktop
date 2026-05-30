/**
 * Celeste POS - Webapp Auto-Updater
 * 
 * Automatically downloads the latest webapp build from the server
 * so the Electron app always has the freshest UI without needing
 * a full app update.
 * 
 * Flow:
 * 1. On app startup, check server for webapp version hash
 * 2. Compare with locally stored hash
 * 3. If different, download the new bundle in background
 * 4. On next restart, use the updated files
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');

const CLOUD_URL = 'https://celestepos.live';
const WEBAPP_VERSION_ENDPOINT = `${CLOUD_URL}/api/webapp-version`;

/**
 * Get the writable webapp directory for updates
 * In production: userData/webapp-cache/
 * This is separate from the bundled webapp (which is read-only in asar)
 */
function getUpdatableWebappDir() {
  const dir = path.join(app.getPath('userData'), 'webapp-cache');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the bundled (read-only) webapp directory
 */
function getBundledWebappDir() {
  if (process.resourcesPath) {
    const asarWebappPublic = path.join(process.resourcesPath, 'webapp', 'public');
    if (fs.existsSync(asarWebappPublic) && fs.existsSync(path.join(asarWebappPublic, 'index.html'))) {
      return asarWebappPublic;
    }
    const asarWebapp = path.join(process.resourcesPath, 'webapp');
    if (fs.existsSync(asarWebapp) && fs.existsSync(path.join(asarWebapp, 'index.html'))) {
      return asarWebapp;
    }
  }
  // Dev mode
  const devWebappPublic = path.join(__dirname, '..', 'webapp', 'public');
  if (fs.existsSync(devWebappPublic) && fs.existsSync(path.join(devWebappPublic, 'index.html'))) {
    return devWebappPublic;
  }
  const devWebapp = path.join(__dirname, '..', 'webapp');
  if (fs.existsSync(devWebapp) && fs.existsSync(path.join(devWebapp, 'index.html'))) {
    return devWebapp;
  }
  return null;
}

/**
 * Get the best available webapp directory
 * Prefers updated cache over bundled version
 */
function getActiveWebappDir() {
  const updatable = getUpdatableWebappDir();
  const indexPath = path.join(updatable, 'index.html');
  
  // Use cached version if it exists and has index.html
  if (fs.existsSync(indexPath)) {
    console.log('[WebappUpdater] Using cached webapp from:', updatable);
    return updatable;
  }
  
  // Fall back to bundled version
  const bundled = getBundledWebappDir();
  if (bundled) {
    console.log('[WebappUpdater] Using bundled webapp from:', bundled);
  }
  return bundled;
}

/**
 * Fetch a URL and return the response body as a string
 */
function fetchText(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        fetchText(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Fetch a URL and return the response body as a Buffer
 */
function fetchBuffer(url, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Check if a webapp update is available
 * Returns { available: boolean, remoteVersion: string, localVersion: string }
 */
async function checkForWebappUpdate(store) {
  try {
    // Fetch the current webapp version from the server
    // The server returns the index.html which contains hashed asset references
    const remoteIndex = await fetchText(`${CLOUD_URL}/index.html`, 10000);
    
    // Extract the main JS bundle hash as the version identifier
    const jsMatch = remoteIndex.match(/src="\/assets\/(index-[^"]+\.js)"/);
    const cssMatch = remoteIndex.match(/href="\/assets\/(index-[^"]+\.css)"/);
    
    if (!jsMatch) {
      console.log('[WebappUpdater] Could not parse remote webapp version');
      return { available: false };
    }
    
    const remoteVersion = jsMatch[1]; // e.g., "index-Cii5uxIN.js"
    const localVersion = store.get('webappVersion', '');
    
    console.log(`[WebappUpdater] Local: ${localVersion || 'none'}, Remote: ${remoteVersion}`);
    
    if (remoteVersion !== localVersion) {
      return { available: true, remoteVersion, localVersion, remoteIndex };
    }
    
    return { available: false, remoteVersion, localVersion };
  } catch (err) {
    console.log('[WebappUpdater] Version check failed:', err.message);
    return { available: false, error: err.message };
  }
}

/**
 * Download and install the latest webapp
 * Downloads index.html, parses asset references, downloads all assets
 */
async function downloadWebappUpdate(store, onProgress) {
  try {
    onProgress?.('Verificando actualización de interfaz...');
    
    // Get the remote index.html
    const remoteIndex = await fetchText(`${CLOUD_URL}/index.html`, 15000);
    
    // Extract all asset references
    const assetMatches = remoteIndex.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g);
    const assets = [...assetMatches].map(m => m[1]);
    
    // Also get manifest.json
    const allFiles = ['/index.html', '/manifest.json', ...assets];
    
    const targetDir = getUpdatableWebappDir();
    const assetsDir = path.join(targetDir, 'assets');
    
    // CRITICAL: Clean old assets before downloading new version
    // Stale files from previous versions cause "Failed to fetch dynamically imported module" errors
    if (fs.existsSync(assetsDir)) {
      console.log('[WebappUpdater] Cleaning old assets directory...');
      const oldFiles = fs.readdirSync(assetsDir);
      for (const file of oldFiles) {
        try { fs.unlinkSync(path.join(assetsDir, file)); } catch { /* ignore */ }
      }
    } else {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    
    onProgress?.(`Descargando ${allFiles.length} archivos...`);
    
    let downloaded = 0;
    let failed = 0;
    
    // Download files in parallel batches of 5
    for (let i = 0; i < allFiles.length; i += 5) {
      const batch = allFiles.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async (filePath) => {
          const url = `${CLOUD_URL}${filePath}`;
          const buffer = await fetchBuffer(url, 30000);
          const localPath = path.join(targetDir, filePath);
          
          // Ensure directory exists
          const dir = path.dirname(localPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          fs.writeFileSync(localPath, buffer);
          return filePath;
        })
      );
      
      results.forEach((r) => {
        if (r.status === 'fulfilled') downloaded++;
        else { failed++; console.warn('[WebappUpdater] Failed to download:', r.reason?.message); }
      });
      
      onProgress?.(`Descargando... ${downloaded}/${allFiles.length}`);
    }
    
    // Now scan the main JS bundle for lazy-loaded chunks
    const mainJsFiles = fs.readdirSync(assetsDir).filter(f => f.startsWith('index-') && f.endsWith('.js'));
    if (mainJsFiles.length > 0) {
      const mainJsContent = fs.readFileSync(path.join(assetsDir, mainJsFiles[0]), 'utf-8');
      const chunkMatches = mainJsContent.match(/[A-Za-z0-9_]+-[A-Za-z0-9_]+\.js/g) || [];
      const uniqueChunks = [...new Set(chunkMatches)].filter(c => !fs.existsSync(path.join(assetsDir, c)));
      
      onProgress?.(`Descargando ${uniqueChunks.length} módulos adicionales...`);
      console.log(`[WebappUpdater] Found ${uniqueChunks.length} lazy-loaded chunks to download`);
      
      let chunkDownloaded = 0;
      for (let i = 0; i < uniqueChunks.length; i += 10) {
        const batch = uniqueChunks.slice(i, i + 10);
        const results = await Promise.allSettled(
          batch.map(async (chunk) => {
            const url = `${CLOUD_URL}/assets/${chunk}`;
            const buffer = await fetchBuffer(url, 30000);
            fs.writeFileSync(path.join(assetsDir, chunk), buffer);
            return chunk;
          })
        );
        results.forEach((r) => {
          if (r.status === 'fulfilled') chunkDownloaded++;
        });
        onProgress?.(`Módulos: ${chunkDownloaded}/${uniqueChunks.length}`);
      }
      
      // Second pass: scan downloaded chunks for nested references (CSS, etc)
      const allJsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
      const nestedSet = new Set();
      for (const jsFile of allJsFiles) {
        const content = fs.readFileSync(path.join(assetsDir, jsFile), 'utf-8');
        const nested = content.match(/[A-Za-z0-9_]+-[A-Za-z0-9_]+\.(js|css)/g) || [];
        nested.forEach(n => {
          if (!fs.existsSync(path.join(assetsDir, n))) nestedSet.add(n);
        });
      }
      
      if (nestedSet.size > 0) {
        console.log(`[WebappUpdater] Downloading ${nestedSet.size} nested assets...`);
        const nestedArr = [...nestedSet];
        for (let i = 0; i < nestedArr.length; i += 10) {
          const batch = nestedArr.slice(i, i + 10);
          await Promise.allSettled(
            batch.map(async (file) => {
              try {
                const buffer = await fetchBuffer(`${CLOUD_URL}/assets/${file}`, 30000);
                fs.writeFileSync(path.join(assetsDir, file), buffer);
              } catch { /* skip */ }
            })
          );
        }
      }
      
      console.log(`[WebappUpdater] Chunk download complete: ${chunkDownloaded} chunks`);
    }
    
    if (failed > allFiles.length * 0.2) {
      // More than 20% of core files failed — don't use this update
      console.error(`[WebappUpdater] Too many failures (${failed}/${allFiles.length}), aborting update`);
      return false;
    }
    
    // Disable service worker in the downloaded index.html
    const indexPath = path.join(targetDir, 'index.html');
    let indexContent = fs.readFileSync(indexPath, 'utf-8');
    indexContent = indexContent.replace(
      /if \('serviceWorker' in navigator\)/,
      "if (false && 'serviceWorker' in navigator)"
    );
    // Remove debug collector and analytics
    indexContent = indexContent.replace(/<script src="\/__manus__\/debug-collector\.js"[^>]*><\/script>/g, '');
    indexContent = indexContent.replace(/<script[^>]*manus-analytics[^>]*><\/script>/g, '');
    fs.writeFileSync(indexPath, indexContent);
    
    // Extract version from the JS bundle name
    const jsMatch = indexContent.match(/src="\/assets\/(index-[^"]+\.js)"/);
    if (jsMatch) {
      store.set('webappVersion', jsMatch[1]);
      store.set('webappLastUpdated', Date.now());
    }
    
    console.log(`[WebappUpdater] Update complete: ${downloaded} files downloaded, ${failed} failed`);
    onProgress?.('Actualización de interfaz completada. Reinicie para aplicar.');
    
    return true;
  } catch (err) {
    console.error('[WebappUpdater] Download failed:', err.message);
    onProgress?.(`Error: ${err.message}`);
    return false;
  }
}

/**
 * Run the full update check and download in background
 * Called after app startup, non-blocking
 */
async function runBackgroundWebappUpdate(store, mainWindow) {
  try {
    const { available, remoteVersion } = await checkForWebappUpdate(store);
    
    if (!available) {
      console.log('[WebappUpdater] Webapp is up to date');
      return;
    }
    
    console.log(`[WebappUpdater] Update available: ${remoteVersion}`);
    
    const success = await downloadWebappUpdate(store, (msg) => {
      console.log(`[WebappUpdater] ${msg}`);
    });
    
    if (success && mainWindow && !mainWindow.isDestroyed()) {
      // Notify the renderer that a UI update is ready (will apply on next restart)
      mainWindow.webContents.executeJavaScript(`
        if (window.CelesteDesktop) {
          window.CelesteDesktop._webappUpdateReady = true;
        }
        // Show a subtle notification
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1a365d;color:white;padding:12px 20px;border-radius:8px;z-index:99999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;';
        toast.textContent = '✨ Actualización de interfaz lista. Click para aplicar.';
        toast.onclick = () => { window.location.reload(); };
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 15000);
      `).catch(() => {});
    }
  } catch (err) {
    console.error('[WebappUpdater] Background update failed:', err.message);
  }
}

module.exports = {
  getActiveWebappDir,
  getBundledWebappDir,
  getUpdatableWebappDir,
  checkForWebappUpdate,
  downloadWebappUpdate,
  runBackgroundWebappUpdate,
};
