/**
 * @file apps/api/src/routes/static-assets.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.join(__dirname, '../../../web');

function isInsideWebRoot(targetPath) {
  const root = path.resolve(WEB_ROOT);
  const resolved = path.resolve(targetPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function sendFile(res, filePath, contentType) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  return res.end(fs.readFileSync(filePath));
}

module.exports = async function staticAssetsRoutes(req, res, pathname, _parsedUrl) {
  if (pathname === '/' || pathname === '/index.html') {
    const indexPath = path.join(WEB_ROOT, 'index.html');
    if (fs.existsSync(indexPath)) {
      return sendFile(res, indexPath, 'text/html; charset=utf-8');
    }
  }

  if (pathname === '/styles.css') {
    const cssPath = path.join(WEB_ROOT, 'styles.css');
    if (fs.existsSync(cssPath)) {
      return sendFile(res, cssPath, 'text/css; charset=utf-8');
    }
  }

  if (pathname === '/app.js') {
    const jsPath = path.join(WEB_ROOT, 'app.js');
    if (fs.existsSync(jsPath)) {
      return sendFile(res, jsPath, 'application/javascript; charset=utf-8');
    }
  }

  if (pathname.startsWith('/js/')) {
    let decoded = pathname;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bad path');
    }
    if (decoded.includes('\0') || decoded.split('/').includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }
    const relative = decoded.replace(/^\/+/, '');
    if (!relative.startsWith('js/') || !relative.endsWith('.js') || relative.includes('\\')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }
    const jsPath = path.resolve(WEB_ROOT, relative);
    if (!isInsideWebRoot(jsPath) || !fs.existsSync(jsPath) || !fs.statSync(jsPath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    return sendFile(res, jsPath, 'application/javascript; charset=utf-8');
  }
};
