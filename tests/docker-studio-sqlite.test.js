'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const composePath = path.join(__dirname, '..', 'docker', 'docker-compose.studio.yml');

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

console.log('\n=== Docker Studio SQLite alignment ===\n');

let passed = 0;
let failed = 0;

if (test('default Studio service uses SQLite and does not require Postgres or Redis', () => {
  const compose = yaml.load(fs.readFileSync(composePath, 'utf8'));
  const studio = compose.services['oas-studio'];
  assert.ok(studio, 'oas-studio service is required');
  const env = studio.environment || [];
  const envText = Array.isArray(env) ? env.join('\n') : JSON.stringify(env);
  assert.doesNotMatch(envText, /DATABASE_URL=/);
  assert.doesNotMatch(envText, /REDIS_URL=/);
  assert.ok(!studio.depends_on || Object.keys(studio.depends_on).length === 0
    || !['postgres', 'redis'].some(name => studio.depends_on[name] || (Array.isArray(studio.depends_on) && studio.depends_on.includes(name))));
  assert.match(envText, /OAS_STUDIO_HOST=/);
})) passed++; else failed++;

if (test('postgres and redis stay optional extras, not the default path', () => {
  const raw = fs.readFileSync(composePath, 'utf8');
  const compose = yaml.load(raw);
  if (compose.services.postgres) {
    assert.ok(
      compose.services.postgres.profiles && compose.services.postgres.profiles.includes('extras'),
      'postgres must be behind the extras profile'
    );
  }
  if (compose.services.redis) {
    assert.ok(
      compose.services.redis.profiles && compose.services.redis.profiles.includes('extras'),
      'redis must be behind the extras profile'
    );
  }
  assert.match(raw, /SQLite/i);
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
