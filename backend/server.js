const http = require('http');

const PORT = Number(process.env.PORT || 9000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allowOrigin = ALLOWED_ORIGIN === '*' ? '*' : (origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

function sendJson(req, res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(req, res, 200, {
      ok: true,
      service: 'shine-backend',
      stage: 'phase-1-connectivity'
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/ping') {
    return sendJson(req, res, 200, {
      ok: true,
      message: 'Shine backend is connected.',
      time: new Date().toISOString()
    });
  }

  return sendJson(req, res, 404, {
    ok: false,
    error: 'NOT_FOUND'
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Shine backend listening on ${PORT}`);
});
