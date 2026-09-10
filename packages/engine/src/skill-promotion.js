/**
 * @file packages/engine/src/skill-promotion.js
 * Builder skills draft first; catalog write requires a passing gate + HITL confirm.
 */

const fs = require('fs');
const path = require('path');

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-(?:live|proj|ant)?[A-Za-z0-9_-]{20,}/
];

function evaluateSkillPromotion(input = {}) {
  const id = String(input.id || input.name || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
  const description = String(input.description || '').trim();
  const instructions = String(input.instructions || '').trim();
  const failures = [];
  if (!id) failures.push('missing-id');
  if (description.length < 24) failures.push('weak-description');
  if (!/when to use/i.test(instructions)) failures.push('missing-when-to-use');
  if (!/how it works/i.test(instructions)) failures.push('missing-how-it-works');
  const blob = `${description}\n${instructions}`;
  if (SECRET_PATTERNS.some(pattern => pattern.test(blob))) failures.push('secret-shaped');
  const passed = failures.length === 0;
  return {
    passed,
    failures,
    id,
    stage: passed && input.confirmPromote ? 'catalog' : 'draft'
  };
}

function renderSkillMarkdown(input = {}) {
  const id = String(input.id || 'custom-skill').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-') || 'custom-skill';
  const triggers = input.triggers
    ? (Array.isArray(input.triggers) ? input.triggers : String(input.triggers).split(','))
      .map(t => String(t).trim()).filter(Boolean)
    : [];
  const triggersYaml = triggers.length
    ? `triggers:\n${triggers.map(t => `  - "${t.replace(/"/g, '\\"')}"`).join('\n')}`
    : 'triggers: []';
  return [
    '---',
    `name: ${id}`,
    `description: "${String(input.description || 'Custom workflow skill.').replace(/"/g, '\\"')}"`,
    triggersYaml,
    'status: unreviewed',
    '---',
    '',
    `# ${input.name || id}`,
    '',
    String(input.instructions || 'Procedural instructions for this workflow skill.')
  ].join('\n');
}

function writeSkillPromotion(input = {}) {
  const evaluation = evaluateSkillPromotion(input);
  const workspaceRoot = path.resolve(input.workspaceRoot || process.cwd());
  const content = renderSkillMarkdown({ ...input, id: evaluation.id });
  if (input.confirmPromote && !evaluation.passed) {
    const err = new Error(`Skill promotion blocked: ${evaluation.failures.join(', ')}`);
    err.code = 'SKILL_PROMOTION_BLOCKED';
    err.evaluation = evaluation;
    throw err;
  }
  const relative = input.confirmPromote && evaluation.passed
    ? path.join('skills', evaluation.id, 'SKILL.md')
    : path.join('.oas', 'promotions', 'drafts', evaluation.id, 'SKILL.md');
  const abs = path.join(workspaceRoot, relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return {
    ...evaluation,
    stage: input.confirmPromote && evaluation.passed ? 'catalog' : 'draft',
    file: relative.replace(/\\/g, '/')
  };
}

module.exports = {
  evaluateSkillPromotion,
  renderSkillMarkdown,
  writeSkillPromotion
};
