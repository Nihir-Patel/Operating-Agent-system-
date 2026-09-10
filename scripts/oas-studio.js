#!/usr/bin/env node
/**
 * OAS Local Studio 0.9 launcher
 *
 * Usage:
 *   node scripts/oas-studio.js [port]
 *
 * Default port: 3458 (or 3459 if busy)
 */

const { OasControlPlaneServer } = require('../apps/api/src/server');

// Global crash resilience: ensure server stays online under network glitches and unhandled promises
process.on('uncaughtException', (err) => {
  console.error('[OAS Studio Process Warning - Uncaught Exception]', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[OAS Studio Process Warning - Unhandled Rejection]', reason);
});

const port = parseInt(process.argv[2] || process.env.OAS_STUDIO_PORT || '3458', 10);
const host = process.env.OAS_STUDIO_HOST || '127.0.0.1';

console.log('\n======================================================');
console.log('  OAS Local Studio 0.9');
console.log('  Loopback operator UI (plugin catalog 2.2.1)');
console.log('======================================================');

try {
  const server = new OasControlPlaneServer({ port, host });
  server.start((srv, actualPort) => {
    console.log(`\n  * Studio UI:      http://${host}:${actualPort}`);
    console.log(`  * Control Plane:  http://${host}:${actualPort}/api/catalog`);
    console.log(`  * Real-time SSE:  http://${host}:${actualPort}/api/stream`);
    console.log(`  * Telemetry:      http://${host}:${actualPort}/api/telemetry\n`);
    console.log('  Press Ctrl+C to shutdown.\n');
  });
} catch (err) {
  console.error('[OAS Studio] Failed to start server:', err.message);
  process.exit(1);
}
