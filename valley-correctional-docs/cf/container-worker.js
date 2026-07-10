// Cloudflare Worker that fronts the containerized Express app.
// Every request is forwarded to the container (which runs `node server.js`
// exactly as in the Dockerfile). The container sleeps after inactivity and
// wakes on the next request.
import { Container, getContainer } from '@cloudflare/containers';

export class DocsContainer extends Container {
  // Must match the port the Node app listens on (server.js -> PORT || 3000).
  defaultPort = 3000;
  // Scale to zero after 30 minutes idle to save resources.
  sleepAfter = '30m';
  // Give the app a moment to boot + run migrations/seed before proxying.
  requiredPorts = [3000];
}

export default {
  async fetch(request, env) {
    // A single shared instance keeps one SQLite database. Pin to one id.
    const container = getContainer(env.DOCS_CONTAINER, 'vcf-docs-singleton');
    return container.fetch(request);
  },
};
