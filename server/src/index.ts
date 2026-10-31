import { fileURLToPath } from 'node:url';
import { createGameServer } from './app';

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

const { httpServer } = createGameServer({ clientDist: CLIENT_DIST });

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
