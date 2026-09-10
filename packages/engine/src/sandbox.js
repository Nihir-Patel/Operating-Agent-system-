/**
 * @file packages/engine/src/sandbox.js
 * OAS Sandboxing & Execution Safety Layer
 */

const ALLOWED_BINARIES = new Set([
  'node', 'npm', 'npx', 'yarn', 'pnpm', 'bun',
  'git', 'ls', 'cat', 'head', 'tail', 'pwd', 'echo', 'printf',
  'grep', 'rg', 'find', 'wc', 'sort', 'uniq', 'diff',
  'python', 'python3', 'pytest', 'pip', 'pip3',
  'go', 'cargo', 'rustc', 'javac', 'java',
  'which', 'true', 'false', 'test', 'mkdir', 'cp', 'mv', 'touch'
]);

const BLOCKED_PATTERNS = [
  /rm\s+(-rf|-fr|--recursive)\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  />\s*\/dev\/sd/i,
  /chmod\s+(-R\s+)?777\s+\//i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev\//i,
  /curl.*\|\s*(bash|sh)/i,
  /wget.*\|\s*(bash|sh)/i,
  /;\s*rm\b/i,
  /&&\s*rm\b/i
];

const CHAIN_METACHARS = /[;|`$]|&&|\|\||\$\(/;

class ExecutionSandbox {
  constructor(options = {}) {
    this.allowedPaths = options.allowedPaths || [process.cwd()];
    this.requireApprovalForDestructive = options.requireApprovalForDestructive !== false;
    this.allowedBinaries = options.allowedBinaries
      ? new Set(options.allowedBinaries)
      : ALLOWED_BINARIES;
  }

  validateCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') {
      return { allowed: false, reason: 'Empty command.', dangerLevel: 'HIGH' };
    }

    const trimmed = cmd.trim();
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          requiresApproval: true,
          dangerLevel: 'CRITICAL',
          reason: `Command matched high-risk destructive safety pattern: ${pattern.toString()}`
        };
      }
    }

    if (/env\b.*curl/i.test(trimmed) || /export\b.*curl/i.test(trimmed) || /\bcurl\b/i.test(trimmed) || /\bwget\b/i.test(trimmed)) {
      return {
        allowed: false,
        requiresApproval: true,
        dangerLevel: 'HIGH',
        reason: 'Network exfiltration commands are blocked by the sandbox allowlist.'
      };
    }

    if (CHAIN_METACHARS.test(trimmed)) {
      return {
        allowed: false,
        requiresApproval: true,
        dangerLevel: 'HIGH',
        reason: 'Shell chaining and substitution metacharacters are not allowed.'
      };
    }

    const firstToken = trimmed.split(/\s+/)[0].replace(/^["']|["']$/g, '');
    const binary = firstToken.split('/').pop();
    if (!this.allowedBinaries.has(binary)) {
      return {
        allowed: false,
        requiresApproval: true,
        dangerLevel: 'HIGH',
        reason: `Binary "${binary}" is not on the sandbox allowlist.`
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      dangerLevel: 'SAFE',
      sanitizedCommand: trimmed
    };
  }

  sanitizeToolParameters(toolName, params = {}) {
    const sanitized = { ...params };
    for (const [key, val] of Object.entries(sanitized)) {
      if (typeof val === 'string') {
        sanitized[key] = val
          .replace(/(bearer\s+)[a-zA-Z0-9_.-]{16,}/gi, '$1[REDACTED_TOKEN]')
          .replace(/(api[_-]?key\s*[:=]\s*)[a-zA-Z0-9_.-]{16,}/gi, '$1[REDACTED_API_KEY]')
          .replace(/(ghp_[a-zA-Z0-9]{20,})/g, '[REDACTED_GITHUB_TOKEN]');
      }
    }
    return sanitized;
  }
}

module.exports = {
  ExecutionSandbox,
  ALLOWED_BINARIES
};
