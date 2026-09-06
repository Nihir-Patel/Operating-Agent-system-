/**
 * @file packages/engine/src/scheduler.js
 * OAS Enterprise Agent DAG Scheduler & State Machine
 */

const EventEmitter = require('events');

class AgentDagScheduler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.activeRuns = new Map();
    this.store = options.store;
  }

  /**
   * Build an execution DAG given a root task or PRD
   */
  createPipeline(taskId, rootIntent, pipelineType = 'feature_lifecycle') {
    let nodes = [];
    if (pipelineType === 'feature_lifecycle') {
      nodes = [
        { id: 'node_planner', agentId: 'planner', role: 'Decompose Intent & Capability Plan', dependencies: [], status: 'pending' },
        { id: 'node_architect', agentId: 'architect', role: 'System Architecture & Contract Spec', dependencies: ['node_planner'], status: 'pending' },
        { id: 'node_tdd', agentId: 'tdd-guide', role: 'TDD Red-Green Implementation', dependencies: ['node_architect'], status: 'pending' },
        { id: 'node_code_review', agentId: 'code-reviewer', role: 'Quality & Immutability Audit', dependencies: ['node_tdd'], status: 'pending' },
        { id: 'node_security', agentId: 'security-reviewer', role: 'Vulnerability Scan & Input Validation', dependencies: ['node_code_review'], status: 'pending' },
        { id: 'node_docs', agentId: 'doc-updater', role: 'Codemap & Documentation Sync', dependencies: ['node_security'], status: 'pending' }
      ];
    } else if (pipelineType === 'build_fix') {
      nodes = [
        { id: 'node_build_fix', agentId: 'build-error-resolver', role: 'Fix Type & Compiler Diagnostics', dependencies: [], status: 'pending' },
        { id: 'node_code_review', agentId: 'code-reviewer', role: 'Verify Minimal Diff Safety', dependencies: ['node_build_fix'], status: 'pending' }
      ];
    } else {
      nodes = [
        { id: 'node_planner', agentId: 'planner', role: 'General Task Planning', dependencies: [], status: 'pending' },
        { id: 'node_executor', agentId: 'loop-operator', role: 'Autonomous Execution', dependencies: ['node_planner'], status: 'pending' }
      ];
    }

    const run = {
      id: taskId,
      intent: rootIntent,
      pipelineType,
      status: 'idle', // 'idle', 'running', 'paused', 'completed', 'aborted'
      currentNodeIndex: 0,
      nodes,
      history: [],
      interventions: []
    };

    this.activeRuns.set(taskId, run);
    return run;
  }

  getRun(taskId) {
    return this.activeRuns.get(taskId);
  }

  getAllRuns() {
    return Array.from(this.activeRuns.values());
  }

  pauseRun(taskId) {
    const run = this.activeRuns.get(taskId);
    if (!run) return null;
    run.status = 'paused';
    this.emit('agent:intervention:paused', { taskId, timestamp: new Date().toISOString() });
    return run;
  }

  resumeRun(taskId) {
    const run = this.activeRuns.get(taskId);
    if (!run) return null;
    run.status = 'running';
    this.emit('agent:intervention:resumed', { taskId, timestamp: new Date().toISOString() });
    return run;
  }

  abortRun(taskId) {
    const run = this.activeRuns.get(taskId);
    if (!run) return null;
    run.status = 'aborted';
    this.emit('agent:intervention:aborted', { taskId, timestamp: new Date().toISOString() });
    return run;
  }

  provideFeedback(taskId, feedback) {
    const run = this.activeRuns.get(taskId);
    if (!run) return null;
    run.interventions.push({
      type: 'user_feedback',
      content: feedback,
      timestamp: new Date().toISOString()
    });
    this.emit('agent:human_in_the_loop:feedback', { taskId, feedback });
    return run;
  }

  /**
   * Advance simulation step for a task node
   */
  advanceStep(taskId, stepData) {
    const run = this.activeRuns.get(taskId);
    if (!run || run.status === 'paused' || run.status === 'aborted') return null;

    run.status = 'running';
    const activeNode = run.nodes.find(n => n.status === 'running') || run.nodes.find(n => n.status === 'pending');
    if (!activeNode) {
      run.status = 'completed';
      this.emit('agent:session:completed', { taskId });
      return run;
    }

    activeNode.status = 'running';
    const stepRecord = {
      stepIndex: run.history.length + 1,
      nodeId: activeNode.id,
      agentId: activeNode.agentId,
      ...stepData,
      timestamp: new Date().toISOString()
    };
    run.history.push(stepRecord);

    // If step finishes node
    if (stepData.isNodeCompleted) {
      activeNode.status = 'completed';
      const allDone = run.nodes.every(n => n.status === 'completed');
      if (allDone) {
        run.status = 'completed';
        this.emit('agent:session:completed', { taskId });
      }
    }

    this.emit('agent:step', { taskId, step: stepRecord });
    return stepRecord;
  }
}

module.exports = {
  AgentDagScheduler
};
