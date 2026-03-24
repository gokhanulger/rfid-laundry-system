const https = require('https');

const BACKEND_HOST = 'rfid-laundry-backend-production.up.railway.app';

module.exports = async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // Build target path: /api/[...path] -> /api/...
  const targetPath = req.url;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-proto'];
  delete headers['x-forwarded-host'];
  headers['host'] = BACKEND_HOST;

  const options = {
    hostname: BACKEND_HOST,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: headers,
    timeout: 30000,
  };

  return new Promise((resolve) => {
    const proxyReq = https.request(options, (proxyRes) => {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      // Forward response headers (skip CORS and transfer-encoding)
      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        if (!key.startsWith('access-control-') && key !== 'transfer-encoding') {
          res.setHeader(key, value);
        }
      });

      res.status(proxyRes.statusCode);

      const chunks = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks);
        res.send(body);
        resolve();
      });
    });

    proxyReq.on('error', (e) => {
      res.status(502).json({ error: 'Backend unavailable', message: e.message });
      resolve();
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({ error: 'Backend timeout' });
      resolve();
    });

    // Forward request body
    if (req.body) {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      proxyReq.write(bodyStr);
    }

    proxyReq.end();
  });
};
