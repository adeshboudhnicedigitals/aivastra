import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 5010);
const resultPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAW0lEQVR4nO3PQQ3AIADAQMC/5yFjRxMFfXpn5i8AAAAAAOBzvAEAAAAAAIBvDwAAAAAAwLcHAAAAAADAtwcAAAAAAMC3BwAAAAAAwLcHAAAAAADAtwcAAAAAAMD3B3MeAc8D5J4MAAAAAElFTkSuQmCC',
  'base64',
);
let lastPromptId = 'phase3-smoke-prompt';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (req.method === 'GET' && url.pathname === '/system_stats') return json(res, 200, { ok: true });
  if (req.method === 'POST' && url.pathname === '/upload/image') {
    req.resume();
    const name = url.searchParams.get('name') || `upload-${Date.now()}.png`;
    return json(res, 200, { name });
  }
  if (req.method === 'POST' && url.pathname === '/prompt') {
    req.resume();
    lastPromptId = `phase3-smoke-${Date.now()}`;
    return json(res, 200, { prompt_id: lastPromptId });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
    const promptId = decodeURIComponent(url.pathname.split('/').pop() || lastPromptId);
    return json(res, 200, {
      [promptId]: {
        outputs: {
          134: { images: [{ filename: 'phase3-result.png', subfolder: '', type: 'output' }] },
        },
      },
    });
  }
  if (req.method === 'GET' && url.pathname === '/view') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': resultPng.length });
    return res.end(resultPng);
  }
  json(res, 404, { error: 'not found' });
}).listen(port, '127.0.0.1', () => {
  console.log(`phase3 mock comfy listening on ${port}`);
});
