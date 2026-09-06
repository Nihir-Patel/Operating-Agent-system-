/**
 * @file packages/engine/src/compactor.js
 * OAS Strategic Context Compaction Engine
 */

class StrategicCompactor {
  constructor(maxContextTokens = 200000, thresholdRatio = 0.8) {
    this.maxContextTokens = maxContextTokens;
    this.thresholdTokens = Math.floor(maxContextTokens * thresholdRatio);
  }

  estimateTokens(text) {
    if (!text) return 0;
    // Standard approximation: ~3.8 characters per token
    return Math.ceil(text.length / 3.8);
  }

  checkCompactionNeed(currentEstimatedTokens) {
    const isExceeded = currentEstimatedTokens >= this.thresholdTokens;
    const utilizationPercent = Math.round((currentEstimatedTokens / this.maxContextTokens) * 100);

    return {
      shouldCompact: isExceeded,
      utilizationPercent,
      currentTokens: currentEstimatedTokens,
      maxTokens: this.maxContextTokens,
      recommendation: isExceeded
        ? 'Context window at ' + utilizationPercent + '%. Run strategic context compaction before next major subagent phase.'
        : 'Context headroom healthy (' + (100 - utilizationPercent) + '% available).'
    };
  }

  generateCompactionSummary(history = []) {
    const totalSteps = history.length;
    const keyDecisions = history
      .filter(h => h.step_type === 'thought' && (h.content.includes('Decision') || h.content.includes('Architecture') || h.content.includes('Plan')))
      .map(h => `- ${h.content.slice(0, 140)}...`);

    const filesModified = history
      .filter(h => h.diff_content)
      .map(h => h.tool_args?.filePath || 'workspace/modified_file')
      .filter((v, i, a) => a.indexOf(v) === i);

    return {
      summary: `Compacted ${totalSteps} historical steps. Preserved ${keyDecisions.length} core architectural invariants and ${filesModified.length} active file modifications.`,
      keyDecisions,
      filesModified,
      tokensFreedEstimate: Math.max(1000, totalSteps * 450)
    };
  }
}

module.exports = {
  StrategicCompactor
};
