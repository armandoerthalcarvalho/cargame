import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const HMR_ENABLED = process.env.ENABLE_HMR === 'true' && process.env.DISABLE_HMR !== 'true';

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
