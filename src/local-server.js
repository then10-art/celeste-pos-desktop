/**
 * Local Server for Celeste POS Desktop
 * 
 * Serves the bundled React frontend from local files and proxies
 * all API calls (/api/*) to the cloud server (celestepos.live).
 * This allows the UI to load instantly without internet while
 * data syncs with the cloud when available.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const CLOUD_URL = 'https://celestepos.live';

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Determine the webapp directory path.
 * In development: ./webapp relative to project root
 * In production (asar): uses extraResources path
 */
function getWebappDir() {
  // Check if running from asar (packaged app)
  if (process.resourcesPath) {
    const asarWebapp = path.join(process.resourcesPath, 'webapp');
    if (fs.existsSync(asarWebapp)) {
      return asarWebapp;
    }
  }
  // Development: relative to src/
  const devWebapp = path.join(__dirname, '..', 'webapp');
  if (fs.existsSync(devWebapp)) {
    return devWebapp;
  }
  return null;
}

/**
 * Proxy a request to the cloud server
 */
function proxyToCloud(req, res) {
  const targetUrl = `${CLOUD_URL}${req.url}`;

  // Collect request body for POST/PUT/PATCH
  let body = [];
  req.on('data', (chunk) => body.push(chunk));
  req.on('end', () => {
    const bodyBuffer = Buffer.concat(body);

    const parsedUrl = new URL(targetUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: parsedUrl.hostname,
        // Remove local origin headers
        origin: CLOUD_URL,
        referer: CLOUD_URL + '/',
      },
      timeout: 30000,
    };

    // Remove hop-by-hop headers
    delete options.headers['connection'];
    delete options.headers['keep-alive'];
    delete options.headers['transfer-encoding'];

    if (bodyBuffer.length > 0) {
      options.headers['content-length'] = bodyBuffer.length;
    }

    const proxyReq = https.request(options, (proxyRes) => {
      // Forward response headers, but fix CORS for local origin
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders['content-encoding']; // Let Node handle encoding
      delete responseHeaders['transfer-encoding'];

      // Allow local origin
      responseHeaders['access-control-allow-origin'] = '*';
      responseHeaders['access-control-allow-credentials'] = 'true';

      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[LocalServer] Proxy error for ${req.url}:`, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'PROXY_ERROR',
        message: 'No se pudo conectar al servidor. Verifique su conexión a internet.',
        offline: true,
      }));
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'PROXY_TIMEOUT',
        message: 'La conexión al servidor tardó demasiado.',
        offline: true,
      }));
    });

    if (bodyBuffer.length > 0) {
      proxyReq.write(bodyBuffer);
    }
    proxyReq.end();
  });
}

/**
 * Serve a static file from the webapp directory
 */
function serveStaticFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const stat = fs.statSync(filePath);
    const headers = {
      'Content-Type': mimeType,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    return false;
  }
  return true;
}

/**
 * Create and start the local HTTP server
 * Returns a promise that resolves with the port number
 */
function startLocalServer() {
  return new Promise((resolve, reject) => {
    const webappDir = getWebappDir();

    if (!webappDir) {
      console.warn('[LocalServer] No webapp directory found — will use cloud URL directly');
      resolve(null);
      return;
    }

    console.log(`[LocalServer] Serving webapp from: ${webappDir}`);

    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, X-Requested-With',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }

      // Proxy API calls to the cloud
      if (urlPath.startsWith('/api/')) {
        proxyToCloud(req, res);
        return;
      }

      // Proxy OAuth callbacks to the cloud
      if (urlPath.startsWith('/oauth/') || urlPath.startsWith('/auth/')) {
        proxyToCloud(req, res);
        return;
      }

      // Try to serve static file
      let filePath = path.join(webappDir, urlPath);

      // Security: prevent directory traversal
      if (!filePath.startsWith(webappDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // Check if file exists
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStaticFile(filePath, res);
        return;
      }

      // For SPA routing: serve index.html for all non-file routes
      const indexPath = path.join(webappDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        serveStaticFile(indexPath, res);
        return;
      }

      // Fallback 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    // Listen on a random available port
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`[LocalServer] Running on http://127.0.0.1:${port}`);
      resolve({ port, server });
    });

    server.on('error', (err) => {
      console.error('[LocalServer] Failed to start:', err.message);
      resolve(null); // Fall back to cloud URL
    });
  });
}

module.exports = { startLocalServer };
