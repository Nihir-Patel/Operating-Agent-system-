/**
 * @file packages/engine/src/sandbox.js
 * OAS Sandboxing & Execution Safety Layer
 */

const BLOCKED_PATTERNS = [
  /rm\s+(-rf|-fr)\s+(\/|~|\$HOME)/i,
  /:(){ :\|:& };:/, // Fork bomb
  />\s*\/dev\/sda/i,
  /chmod\s+(-R\s+)?777\s+\//i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev\//i,
  /curl.*\|\s*(bash|sh)/i,
  /wget.*\|\s*(bash|sh)/i
];

class ExecutionSandbox {
  constructor(options = {}) {
    this.allowedPaths = options.allowedPaths || [process.cwd()];
    this.requireApprovalForDestructive = options.requireApprovalForDestructive !== false;
  }

  /**
   * Audit a bash command before execution
   */
  validateCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') {
      return { allowed: false, reason: 'Empty command.' };
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

    // Check for potential environment exfiltration
    if (/env\b.*curl/i.test(trimmed) || /export\b.*curl/i.test(trimmed)) {
      return {
        allowed: false,
        requiresApproval: true,
        dangerLevel: 'HIGH',
        reason: 'Potential secret exfiltration detected in shell command pipeline.'
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      dangerLevel: 'SAFE',
      sanitizedCommand: trimmed
    };
  }

  /**
   * Sanitize tool parameters before passing to agents
   */
  sanitizeToolParameters(toolName, params = {}) {
    const sanitized = { ...params };
    // Redact suspected secrets
    for (const [key, val] of Object.entries(sanitized)) {
      if (typeof val === 'string') {
        sanitized[key] = val
          .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{16,}/gi, '$1[REDACTED_TOKEN]')
          .replace(/(api[_-]?key\s*[:=]\s*)[a-zA-Z0-9_\-\.]{16,}/gi, '$1[REDACTED_API_KEY]')
          .replace(/(ghp_[a-zA-Z0-9]{20,})/g, '[REDACTED_GITHUB_TOKEN]');
      }
    }
    return sanitized;
  }
}

module.exports = {
  ExecutionSandbox
};
