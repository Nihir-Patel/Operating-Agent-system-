/**
 * @file packages/engine/src/command-runner.js
 * Interactive Slash Command Execution Engine
 */

class CommandRunner {
  constructor(options = {}) {
    this.scheduler = options.scheduler;
    this.runner = options.runner;
    this.compactor = options.compactor;
    this.store = options.store;
    this.worktrees = options.worktrees;
    this.catalog = options.catalog || { commands: [], agents: [], skills: [] };
  }

  async executeCommand(rawCommand, context = {}) {
    const trimmed = (rawCommand || '').trim();
    if (!trimmed.startsWith('/')) {
      return { status: 'error', message: 'Commands must begin with a forward slash (e.g. /plan, /tdd, /loop).' };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    const sessionId = context.sessionId || 'sess_cli_' + Date.now().toString(36);
    const timestamp = new Date().toISOString();

    switch (cmdName) {
      case 'plan':
      case 'prd':
        return this.handlePlanCommand(sessionId, args || 'Decompose system capability');
      case 'tdd':
        return this.handleTddCommand(sessionId, args || 'Execute TDD red-green cycle');
      case 'loop':
        return this.handleLoopCommand(sessionId, args || 'Continuous agent iteration loop');
      case 'build-fix':
        return this.handleBuildFixCommand(sessionId, args);
      case 'code-review':
        return this.handleCodeReviewCommand(sessionId, args);
      case 'security-scan':
        return this.handleSecurityScanCommand(sessionId, args);
      case 'compact':
        return this.handleCompactCommand(sessionId);
      case 'checkpoint':
        return this.handleCheckpointCommand(sessionId, args);
      case 'aside':
        return {
          status: 'success',
          command: cmdName,
          output: `[aside] Query recorded without context displacement: "${args || 'No query specified'}". Resume the active task.`,
          timestamp
        };
      default:
        return this.handleCatalogCommand(cmdName, args, sessionId, timestamp);
    }
  }

  handleCatalogCommand(cmdName, args, sessionId, timestamp) {
    const catalog = this.catalog || {};
    const commands = catalog.commands || [];
    const agents = catalog.agents || [];
    const skills = catalog.skills || [];
    const command = commands.find(c => c.id === cmdName || c.id.replace(/_/g, '-') === cmdName);
    const agent = agents.find(a => a.id === cmdName || a.id.startsWith(cmdName) || (command && a.id.startsWith(command.id)));
    const skill = skills.find(s => s.id === cmdName || s.id.includes(cmdName) || (command && s.id.includes(command.id)));
    const pipelineType = cmdName.includes('build') || cmdName.includes('fix') ? 'build_fix' : 'feature_lifecycle';
    if (this.scheduler) {
      const run = this.scheduler.createPipeline(sessionId, args || cmdName, pipelineType);
      return {
        status: 'success',
        command: cmdName,
        delegated: true,
        matched: {
          command: command ? command.id : null,
          agent: agent ? agent.id : null,
          skill: skill ? skill.id : null
        },
        output: `[/${cmdName}] Mapped to ${agent ? agent.id : (skill ? skill.id : pipelineType)} pipeline. Execute the session to run the next agent.`,
        pipeline: run,
        timestamp
      };
    }
    return {
      status: 'success',
      command: cmdName,
      delegated: true,
      output: `[/${cmdName}] Recorded. No scheduler is configured, so a pipeline was not created.`,
      timestamp
    };
  }

  handlePlanCommand(sessionId, args) {
    if (this.scheduler) {
      const run = this.scheduler.createPipeline(sessionId, args, 'feature_lifecycle');
      return {
        status: 'success',
        command: 'plan',
        message: `Plan pipeline initialized for: "${args}"`,
        pipeline: run,
        output: `[planner] Feature lifecycle DAG created with ${run.nodes.length} nodes. Execute /api/sessions/${sessionId}/execute to run the next agent.`
      };
    }
    return { status: 'error', command: 'plan', output: 'Scheduler is not configured.' };
  }

  handleTddCommand(sessionId, args) {
    if (this.scheduler) {
      const run = this.scheduler.createPipeline(sessionId, args, 'feature_lifecycle');
      run.nodes[0].status = 'completed';
      run.nodes[1].status = 'completed';
      run.nodes[2].status = 'running';
      return {
        status: 'success',
        command: 'tdd',
        output: `[tdd-guide] TDD pipeline advanced to the tdd-guide node for "${args}". Coverage target remains 80%+.`,
        pipeline: run
      };
    }
    return { status: 'error', command: 'tdd', output: 'Scheduler is not configured.' };
  }

  handleLoopCommand(sessionId, args) {
    if (this.scheduler) {
      const run = this.scheduler.createPipeline(sessionId, args, 'feature_lifecycle');
      return {
        status: 'success',
        command: 'loop',
        output: `[loop-operator] Continuous loop pipeline created for "${args}". Advance via /execute.`,
        pipeline: run
      };
    }
    return {
      status: 'success',
      command: 'loop',
      output: `[loop-operator] Loop request recorded for "${args}". Scheduler unavailable.`
    };
  }

  handleBuildFixCommand(sessionId, args) {
    if (this.scheduler) {
      const run = this.scheduler.createPipeline(sessionId, args || 'Fix build diagnostics', 'build_fix');
      return {
        status: 'success',
        command: 'build-fix',
        output: `[build-error-resolver] Build-fix pipeline created. Execute the session to diagnose compiler errors.`,
        pipeline: run
      };
    }
    return { status: 'error', command: 'build-fix', output: 'Scheduler is not configured.' };
  }

  handleCodeReviewCommand(sessionId, args) {
    if (this.scheduler) {
      const run = this.scheduler.createPipeline(sessionId, args || 'Review current changes', 'feature_lifecycle');
      return {
        status: 'success',
        command: 'code-review',
        output: `[code-reviewer] Review pipeline created for "${args || 'current changes'}". Results will come from the live agent run, not a canned verdict.`,
        pipeline: run
      };
    }
    return { status: 'error', command: 'code-review', output: 'Scheduler is not configured.' };
  }

  handleSecurityScanCommand(sessionId, args) {
    if (this.scheduler) {
      const run = this.scheduler.createPipeline(sessionId, args || 'Security scan', 'feature_lifecycle');
      return {
        status: 'success',
        command: 'security-scan',
        output: `[security-reviewer] Security scan pipeline created. Use POST /api/security/scan for the live workspace audit.`,
        pipeline: run
      };
    }
    return { status: 'error', command: 'security-scan', output: 'Scheduler is not configured.' };
  }

  handleCompactCommand(sessionId) {
    if (this.compactor && this.store) {
      const steps = this.store.getSteps ? this.store.getSteps(sessionId) : [];
      const summary = this.compactor.generateCompactionSummary(steps.length ? steps : [
        { step_type: 'thought', content: 'No prior steps in this session; compaction baseline only.' }
      ]);
      return {
        status: 'success',
        command: 'compact',
        output: `[strategic-compact] ${summary.summary} Estimated ${summary.tokensFreedEstimate} tokens reclaimed.`,
        tokensFreed: summary.tokensFreedEstimate
      };
    }
    if (this.compactor) {
      const summary = this.compactor.generateCompactionSummary([
        { step_type: 'thought', content: 'No prior steps in this session; compaction baseline only.' }
      ]);
      return {
        status: 'success',
        command: 'compact',
        output: `[strategic-compact] ${summary.summary} Estimated ${summary.tokensFreedEstimate} tokens reclaimed.`,
        tokensFreed: summary.tokensFreedEstimate
      };
    }
    return { status: 'error', command: 'compact', output: 'Compactor is not configured.' };
  }

  handleCheckpointCommand(sessionId, args) {
    const label = args || 'manual_checkpoint';
    if (this.store) {
      const mem = this.store.addMemory({
        scope: 'project',
        kind: 'checkpoint',
        title: `Checkpoint: ${label}`,
        body: `Workflow state snapshot at ${new Date().toISOString()}`
      });
      return {
        status: 'success',
        command: 'checkpoint',
        output: `[checkpoint] Workflow snapshot saved to Memory Vault. Checkpoint ID: ${mem.id} (Hash: ${mem.hash}).`
      };
    }
    return { status: 'error', command: 'checkpoint', output: 'Store is not configured.' };
  }
}

module.exports = {
  CommandRunner
};
