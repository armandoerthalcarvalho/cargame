import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const HMR_ENABLED = process.env.ENABLE_HMR === 'true' && process.env.DISABLE_HMR !== 'true';

/**
 * Spec-compatible Vite dev client shim used when HMR is disabled (e.g. Cloud Run preview).
 * Supports CSS hot-injection (`updateStyle`/`removeStyle`) and module `createHotContext`
 * without ever opening a WebSocket, completely preventing unhandled WebSocket rejection logs.
 */
const NO_HMR_VITE_CLIENT_SHIM = `
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) {
  return url;
}
export class ErrorOverlay extends HTMLElement {}
`;

async function createServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  if (IS_PROD) {
    const distPath = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    if (!HMR_ENABLED) {
      process.env.DISABLE_HMR = 'true';
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(NO_HMR_VITE_CLIENT_SHIM);
      });
    }

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: HMR_ENABLED ? { server: httpServer } : false,
        watch: HMR_ENABLED ? undefined : null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Solstice Circuit server running at http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
