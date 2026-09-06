/**
 * @file packages/engine/src/agent-runner.js
 * Autonomous Agent Tool Execution Loop
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { UniversalModelGateway } = require('./llm-gateway');
const { ExecutionSandbox } = require('./sandbox');

class AgentRunner {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.sandbox = options.sandbox || new ExecutionSandbox({ allowedPaths: [this.workspaceRoot] });
    this.gateway = options.gateway || new UniversalModelGateway(options);
    this.store = options.store;
  }

  /**
   * Execute a single subagent run cycle
   */
  async executeAgentCycle(agentDef, taskPrompt, callbacks = {}) {
    const { onStepChunk, onToolExecution, onStepDone } = callbacks;

    const streamResult = await this.gateway.streamCompletion({
      agentId: agentDef.id,
      model: agentDef.model || 'sonnet',
      systemPrompt: agentDef.systemPrompt || '',
      prompt: taskPrompt
    }, {
      onToken: token => {
        if (onStepChunk) onStepChunk({ agentId: agentDef.id, text: token });
      },
      onToolCall: toolCall => {
        const executionResult = this.executeTool(toolCall.tool, toolCall.args);
        if (onToolExecution) {
          onToolExecution({
            agentId: agentDef.id,
            tool: toolCall.tool,
            args: toolCall.args,
            result: executionResult
          });
        }
      }
    });

    const finalStep = {
      agentId: agentDef.id,
      model: streamResult.model,
      provider: streamResult.provider,
      output: streamResult.text,
      timestamp: new Date().toISOString()
    };

    if (onStepDone) onStepDone(finalStep);
    return finalStep;
  }

  /**
   * Execute a tool safely through the sandbox
   */
  executeTool(toolName, args = {}) {
    const sanitizedArgs = this.sandbox.sanitizeToolParameters(toolName, args);

    if (toolName === 'read_file') {
      const targetPath = path.resolve(this.workspaceRoot, sanitizedArgs.path || '');
      if (fs.existsSync(targetPath)) {
        try {
          const content = fs.readFileSync(targetPath, 'utf8');
          return { status: 'success', content: content.slice(0, 4000), truncated: content.length > 4000 };
        } catch (err) {
          return { status: 'error', error: err.message };
        }
      }
      return { status: 'error', error: 'File not found: ' + sanitizedArgs.path };
    }

    if (toolName === 'write_file') {
      const targetPath = path.resolve(this.workspaceRoot, sanitizedArgs.path || '');
      // Ensure path is within workspace
      if (!targetPath.startsWith(this.workspaceRoot)) {
        return { status: 'error', error: 'Path outside workspace root' };
      }
      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, sanitizedArgs.content || '', 'utf8');
        return { status: 'success', path: sanitizedArgs.path, bytesWritten: (sanitizedArgs.content || '').length };
      } catch (err) {
        return { status: 'error', error: err.message };
      }
    }

    if (toolName === 'run_command') {
      const cmd = sanitizedArgs.command || '';
      const validation = this.sandbox.validateCommand(cmd);
      if (!validation.allowed) {
        return { status: 'blocked', reason: validation.reason, dangerLevel: validation.dangerLevel };
      }

      try {
        const proc = spawnSync('sh', ['-c', cmd], {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          timeout: 15000
        });
        return {
          status: 'success',
          exitCode: proc.status,
          stdout: proc.stdout?.slice(0, 2000),
          stderr: proc.stderr?.slice(0, 2000)
        };
      } catch (err) {
        return { status: 'error', error: err.message };
      }
    }

    return { status: 'unsupported_tool', tool: toolName };
  }
}

module.exports = {
  AgentRunner
};
