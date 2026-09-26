// Serve only a previously built Storybook, on loopback, for integration tests.
import { preview } from 'vite';
const server = await preview({ configFile: false, build: { outDir: 'storybook-static' }, preview: { host: '127.0.0.1', port: 6008, strictPort: true } });
const stop = () => server.httpServer.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
