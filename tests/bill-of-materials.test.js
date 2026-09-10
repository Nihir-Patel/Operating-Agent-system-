/**
 * @file tests/bill-of-materials.test.js
 * SBOM and AIPOM must be generated from the lockfile and catalog, not static fixtures.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildCycloneDxSbom, buildAipom } = require('../packages/engine/src/bill-of-materials');

const workspaceRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'));

function run() {
  console.log('=== BILL OF MATERIALS (LOCKFILE + CATALOG) ===\n');

  const sbom = buildCycloneDxSbom({ workspaceRoot });
  assert.strictEqual(sbom.bomFormat, 'CycloneDX');
  assert.strictEqual(sbom.specVersion, '1.5');
  assert.ok(String(sbom.serialNumber).startsWith('urn:uuid:'), 'serialNumber must be a uuid URN');
  assert.ok(!sbom.serialNumber.includes('oas-cyclonedx-2026-v2-sbom'), 'must not use a hardcoded serial');
  assert.strictEqual(sbom.metadata.component.name, pkg.name);
  assert.strictEqual(sbom.metadata.component.version, pkg.version);
  assert.ok(Array.isArray(sbom.components));
  assert.ok(sbom.components.some(c => c.name === 'js-yaml' && c.version === '4.3.2'), 'SBOM must include lockfile js-yaml');
  assert.ok(sbom.components.some(c => c.name === 'sql.js'), 'SBOM must include lockfile sql.js');
  assert.ok(!sbom.components.some(c => c.name === '@oas/engine'), 'must not invent unpublished @oas/* packages');
  assert.ok(sbom.components.length >= Object.keys(pkg.dependencies || {}).length);
  console.log(`   CycloneDX SBOM built from lockfile (${sbom.components.length} components)`);

  const catalog = {
    agents: [
      { id: 'planner', name: 'planner', model: 'sonnet' },
      { id: 'architect', name: 'architect', model: 'opus' }
    ],
    skills: [{ id: 'tdd-workflow' }, { id: 'security-review' }],
    commands: [{ id: 'plan' }]
  };
  const settings = {
    provider: 'ollama',
    ollamaModel: 'qwen2.5-coder:7b',
    sandboxEnabled: true,
    worktreeIsolation: false
  };
  const aipom = buildAipom({ catalog, settings, packageJson: pkg });
  assert.strictEqual(aipom.schemaVersion, 'oas.aipom.v1');
  assert.strictEqual(aipom.system.name, pkg.name);
  assert.strictEqual(aipom.system.version, pkg.version);
  assert.ok(!aipom.system.leadArchitect, 'must not invent a lead architect');
  assert.strictEqual(aipom.configuredModel, 'qwen2.5-coder:7b');
  assert.ok(aipom.models.some(m => m.modelId === 'qwen2.5-coder:7b' && m.provider === 'ollama'));
  assert.strictEqual(aipom.agents.count, 2);
  assert.deepStrictEqual(aipom.agents.ids, ['planner', 'architect']);
  assert.strictEqual(aipom.skills.count, 2);
  assert.strictEqual(aipom.commands.count, 1);
  assert.strictEqual(aipom.guardrailPolicies.sandboxEnabled, true);
  assert.strictEqual(aipom.guardrailPolicies.worktreeIsolation, false);
  assert.ok(!aipom.guardrailPolicies.tcasAirspaceEnforced, 'must not claim unverified TCAS policy');
  console.log('   AIPOM built from model registry + catalog + settings');

  console.log('\n======================================================');
  console.log('  BILL OF MATERIALS TESTS PASSED');
  console.log('======================================================\n');
}

run();
