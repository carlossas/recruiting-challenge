/**
 * Server entry point: prepares the database and starts listening.
 */
import { createApp } from './app.js';
import { getConfig } from './config/env.js';
import { initSchema } from './db.js';
import { seedIfEmpty } from './scripts/seed.js';

initSchema();
seedIfEmpty();

const config = getConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`dashboard server listening on http://localhost:${config.port}`);
  if (config.devAdminSession) {
    console.warn('⚠ local dev: auto-issuing admin session cookies for loopback requests (DEV_ADMIN_SESSION=off disables it)');
  }
});
