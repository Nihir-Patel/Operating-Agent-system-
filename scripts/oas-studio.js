#!/usr/bin/env node
/**
 * OAS Studio & Cloud Control Plane Launcher
 *
 * Usage:
 *   node scripts/oas-studio.js [port]
 *
 * Default port: 3456 (or 3457 if busy)
 */

const { OasControlPlaneServer } = require('../apps/api/src/server');

const port = parseInt(process.argv[2] || process.env.OAS_STUDIO_PORT || '3456', 10);
const host = process.env.OAS_STUDIO_HOST || '127.0.0.1';

console.log('\n======================================================');
console.log('  OAS ENTERPRISE STUDIO & CLOUD CONTROL PLANE');
console.log('  Operating Agent Systems v2.2.1');
console.log('======================================================');

try {
  const server = new OasControlPlaneServer({ port, host });
  server.start();

  console.log(`\n  * Studio UI:      http://${host}:${port}`);
  console.log(`  * Control Plane:  http://${host}:${port}/api/catalog`);
  console.log(`  * Real-time SSE:  http://${host}:${port}/api/stream`);
  console.log(`  * Telemetry:      http://${host}:${port}/api/telemetry\n`);
  console.log('  Press Ctrl+C to shutdown.\n');
} catch (err) {
  console.error('[OAS Studio] Failed to start server:', err.message);
  process.exit(1);
}
