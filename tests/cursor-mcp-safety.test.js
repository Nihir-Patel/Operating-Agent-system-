'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  ALLOWED_CURSOR_MCP_SERVERS,
  readCursorMcpConfig,
} = require('../packages/engine/src/studio-first-run');

const repoRoot = path.resolve(__dirname, '..');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

console.log('\n=== Cursor project MCP safety ===\n');

let passed = 0;
let failed = 0;

if (test('ships only keyless allowlisted servers', () => {
  const config = readCursorMcpConfig(repoRoot);
  const names = Object.keys(config.mcpServers);
  assert.deepStrictEqual(names.sort(), [...ALLOWED_CURSOR_MCP_SERVERS].sort());
  assert.strictEqual(config.mcpServers['chrome-devtools'].command, 'npx');
  assert.strictEqual(config.mcpServers['oas-memory-vault'].command, 'node');
  assert.strictEqual(config.mcpServers['oas-studio-read'].command, 'node');
  assert.ok(config.mcpServers['oas-memory-vault'].args[0].endsWith('scripts/memory-mcp.mjs'));
  assert.ok(config.mcpServers['oas-studio-read'].args[0].endsWith('scripts/oas-studio-mcp.js'));
})) passed++; else failed++;

if (test('does not commit secrets, placeholders, or absolute personal paths', () => {
  const raw = fs.readFileSync(path.join(repoRoot, '.cursor', 'mcp.json'), 'utf8');
  assert.doesNotMatch(raw, /YOUR_[A-Z0-9_]+/);
  assert.doesNotMatch(raw, /API_KEY|TOKEN|SECRET|PASSWORD/);
  assert.doesNotMatch(raw, /\/Users\/|\/home\/|[A-Za-z]:\\/);
  assert.doesNotMatch(raw, /sk-|ghp_|xox[baprs]-/);
})) passed++; else failed++;

if (test('memory vault identity is server-bound to cursor', () => {
  const config = readCursorMcpConfig(repoRoot);
  assert.strictEqual(config.mcpServers['oas-memory-vault'].env.OAS_MEMORY_HARNESS, 'cursor');
  assert.ok(!config.mcpServers['oas-memory-vault'].env.OAS_MEMORY_ALLOW_USER_SCOPE);
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
