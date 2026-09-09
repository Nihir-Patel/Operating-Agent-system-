/**
 * @file apps/api/src/routes/static-assets.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.join(__dirname, '../../../web');

module.exports = async function staticAssetsRoutes(req, res, pathname, parsedUrl) {
  if (pathname === '/' || pathname === '/index.html') {
    const indexPath = path.join(WEB_ROOT, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return res.end(fs.readFileSync(indexPath));
    }
  }

  if (pathname === '/styles.css') {
    const cssPath = path.join(WEB_ROOT, 'styles.css');
    if (fs.existsSync(cssPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return res.end(fs.readFileSync(cssPath));
    }
  }

  if (pathname === '/app.js') {
    const jsPath = path.join(WEB_ROOT, 'app.js');
    if (fs.existsSync(jsPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return res.end(fs.readFileSync(jsPath));
    }
  }
};
