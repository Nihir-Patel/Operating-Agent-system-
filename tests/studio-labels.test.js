/**
 * @file tests/studio-labels.test.js
 * Sample vs live GitHub labels for Studio sessions and inbox rows.
 */

const assert = require('assert');
const {
  isSampleGithubWork,
  formatGithubSessionTitle,
  formatStudioWorkLabel,
} = require('../packages/engine/src/studio-labels');

function run() {
  console.log('\n=== Studio GitHub labels ===\n');

  assert.strictEqual(
    formatGithubSessionTitle({
      issueNumber: 42,
      issueTitle: 'Fix intermittent timeout in test suite',
      sample: true,
    }),
    'Sample #42 · Fix intermittent timeout in test suite'
  );
  assert.strictEqual(
    formatGithubSessionTitle({
      issueNumber: 99,
      issueTitle: 'New flake',
      sample: false,
    }),
    'GitHub Issue #99: New flake'
  );
  assert.strictEqual(
    formatGithubSessionTitle({
      issueTitle: 'Webhook received (no issue payload)',
      sample: true,
    }),
    'Sample · Webhook received (no issue payload)'
  );
  console.log('   session titles distinguish sample from live GitHub');

  assert.strictEqual(
    isSampleGithubWork({
      source: 'github-issue',
      sourceId: '42',
      title: 'Fix intermittent timeout in test suite',
      url: '',
    }),
    true
  );
  assert.strictEqual(
    isSampleGithubWork({
      source: 'github-issue',
      sourceId: '12',
      title: 'Real bug',
      url: 'https://github.com/Nihir-Patel/Operating-Agent-system-/issues/12',
    }),
    false
  );
  assert.strictEqual(
    formatStudioWorkLabel({
      source: 'github-issue',
      sourceId: '9',
      title: 'Fix security regression in auth',
      url: '',
    }),
    'Sample #9 · Fix security regression in auth'
  );
  assert.strictEqual(
    formatStudioWorkLabel({
      source: 'github-issue',
      sourceId: '9',
      title: 'Sample #9 · Fix security regression in auth',
      sample: true,
    }),
    'Sample #9 · Fix security regression in auth'
  );
  console.log('   inbox rows without a GitHub URL are labeled Sample');
}

run();
