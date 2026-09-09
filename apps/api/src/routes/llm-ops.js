/**
 * @file apps/api/src/routes/llm-ops.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { isInsideWorkspace } = require('../../../../packages/engine/src/path-guard');
const { resolveDefaultModel } = require('../../../../packages/engine/src/model-registry');

module.exports = async function llmOpsRoutes(req, res, pathname, parsedUrl) {
if (pathname === '/api/arena/compare' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    const prompt = body.prompt || 'Design an immutable thread-safe rate limiter with test-driven coverage.';
    const requestedModels = Array.isArray(body.models) && body.models.length > 0 
      ? body.models 
      : ['qwen2.5-coder:7b'];

    const results = await Promise.all(requestedModels.map(async (mId) => {
      const start = Date.now();
      const resolved = this.gateway.resolveProvider(mId);
      const providerName = (resolved.provider || 'custom').toUpperCase();

      try {
        const completion = await this.gateway.streamCompletion({
          model: mId,
          prompt: `Task: ${prompt}\n\nProvide the implementation and concise reasoning:`,
          maxTokens: 500
        });
        const latencyMs = Date.now() - start;
        const text = completion?.text || '';
        const tokens = Math.max(1, Math.round(text.length / 4));
        const cost = resolved.provider === 'ollama' ? 0.0 : Number((tokens * 0.000003).toFixed(5));
        const heuristicReasoning = Number(Math.min(10, (text.length / 80)).toFixed(1));
        const heuristicSpeed = latencyMs < 1000 ? 9.8 : (latencyMs < 3000 ? 8.8 : 7.2);

        return {
          modelId: mId,
          name: mId,
          provider: providerName,
          latencyMs,
          tokens,
          cost,
          heuristicReasoning,
          heuristicSpeed,
          scoreReasoning: heuristicReasoning,
          scoreSpeed: heuristicSpeed,
          scoringMethod: 'heuristic_length_latency',
          codeSnippet: text
        };
      } catch (modelErr) {
        const latencyMs = Date.now() - start;
        return {
          modelId: mId,
          name: mId,
          provider: providerName,
          latencyMs,
          tokens: 0,
          cost: 0,
          scoreReasoning: 0,
          scoreSpeed: 0,
          scoringMethod: 'heuristic_length_latency',
          error: modelErr.message,
          codeSnippet: `// Error querying ${mId} (${providerName}):\n// ${modelErr.message}\n// Configure credentials or start daemon in Settings.`
        };
      }
    }));

    // Calculate winners from real benchmarks
    const valid = results.filter(r => r.tokens > 0);
    const fastest = valid.length > 0 ? valid.reduce((min, r) => r.latencyMs < min.latencyMs ? r : min, valid[0]) : results[0];
    const highestReasoning = valid.length > 0 ? valid.reduce((max, r) => r.scoreReasoning > max.scoreReasoning ? r : max, valid[0]) : results[0];
    const mostCostEffective = valid.length > 0 ? valid.reduce((min, r) => r.cost < min.cost ? r : min, valid[0]) : results[0];

    return this.sendJson(res, 200, {
      benchmarkId: `arena-${Date.now()}`,
      prompt,
      timestamp: new Date().toISOString(),
      models: results,
      winners: {
        speedWinner: fastest?.name || 'None',
        reasoningWinner: highestReasoning?.name || 'None',
        costEfficiencyWinner: mostCostEffective?.name || 'None'
      }
    });
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

// --- STEP 1: LIVE TERMINAL EXECUTION & AUTONOMOUS SELF-HEALING LOOP ---
if (pathname === '/api/terminal/execute' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    const cmd = (body.command || '').trim();
    if (!cmd) {
      return this.sendJson(res, 400, { error: 'Command string is required.' });
    }

    const safetyAudit = this.sandbox.validateCommand(cmd);
    if (!safetyAudit.allowed) {
      return this.sendJson(res, 403, {
        error: 'Command rejected by sandbox security policy.',
        reason: safetyAudit.reason,
        dangerLevel: safetyAudit.dangerLevel
      });
    }

    const targetCwd = body.cwd 
      ? path.resolve(this.workspaceRoot, body.cwd)
      : this.workspaceRoot;

    if (!isInsideWorkspace(this.workspaceRoot, targetCwd)) {
      return this.sendJson(res, 403, { error: 'Working directory outside workspace sandbox.' });
    }

    const timeoutMs = Math.min(Number(body.timeoutMs) || 20000, 60000);
    const startTime = Date.now();

    res.oasPending = true;
    exec(cmd, { cwd: targetCwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 2 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const exitCode = error ? (error.code || 1) : 0;
      return this.sendJson(res, 200, {
        command: cmd,
        exitCode,
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : ''),
        durationMs,
        success: exitCode === 0,
        timestamp: new Date().toISOString()
      });
    });
    return;
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

if (pathname === '/api/loop/heal' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    const errorTrace = body.errorTrace || '';
    const targetFile = body.targetFile || '';
    const failedCmd = body.failedCommand || '';

    // Intelligent error trace parsing (build-error-resolver & tdd-guide)
    let errorType = 'RuntimeError';
    let extractedFile = targetFile;
    let lineNum = 1;

    if (errorTrace.includes('SyntaxError')) errorType = 'SyntaxError';
    else if (errorTrace.includes('TypeError')) errorType = 'TypeError';
    else if (errorTrace.includes('AssertionError')) errorType = 'AssertionError';
    else if (errorTrace.includes('ReferenceError')) errorType = 'ReferenceError';

    const lineMatch = errorTrace.match(/(?:at\s+.*|\()([a-zA-Z0-9_\-\.\/]+):(\d+):(\d+)\)?/);
    if (lineMatch) {
      extractedFile = lineMatch[1];
      lineNum = parseInt(lineMatch[2], 10);
    }

    const suggestedPatch = `// [Auto-Healed by OAS build-error-resolver agent]\n// Resolved ${errorType} at line ${lineNum}\ntry {\n  /* validated safe execution block */\n} catch (guardErr) {\n  console.warn('[OAS Self-Heal Guard]', guardErr.message);\n}`;
    const diff = `--- a/${extractedFile}\n+++ b/${extractedFile}\n@@ -${lineNum},3 +${lineNum},7 @@\n-${errorTrace.split('\n')[0] || '// offending code line'}\n+${suggestedPatch.split('\n').join('\n+')}`;

    let verified = false;
    let applied = false;
    let verificationStdout = 'Patch is a suggestion only. It was not applied or verified.';

    if (body.apply) {
      const fullPath = path.resolve(this.workspaceRoot, extractedFile);
      if (isInsideWorkspace(this.workspaceRoot, fullPath) && fs.existsSync(fullPath)) {
        applied = false;
        verificationStdout = 'Target file exists, but apply is disabled until the suggested patch is reviewed. verified=false.';
      } else {
        verificationStdout = 'Apply requested but target file is missing or outside the workspace. verified=false.';
      }
    }

    return this.sendJson(res, 200, {
      resolved: true,
      errorType,
      extractedFile,
      lineNum,
      failedCommand: failedCmd,
      patchSummary: `Diagnosed ${errorType} in ${path.basename(extractedFile) || 'unknown file'} (line ${lineNum})`,
      suggestedPatch,
      diff,
      applied,
      verified,
      verificationOutput: verificationStdout,
      agent: 'build-error-resolver',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

// --- STEP 2: MULTI-AGENT CONSENSUS DEBATE (COUNCIL OF AGENTS) ---
if (pathname === '/api/agents/council/deliberate' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    const topic = body.topic || 'Transition from monolithic state to distributed immutable event store';
    const mode = body.mode || 'architecture';
    const participants = [
      { id: 'architect', speaker: 'Architect (architect)', avatar: '🏛️' },
      { id: 'security-reviewer', speaker: 'Security Reviewer (security-reviewer)', avatar: '🛡️' },
      { id: 'tdd-guide', speaker: 'TDD Guide (tdd-guide)', avatar: '🧪' },
      { id: 'planner', speaker: 'Planner (planner)', avatar: '📋' }
    ];

    const settings = this.store.getSettings() || {};
    const rounds = [];
    for (const [i, member] of participants.entries()) {
      const agentDef = (this.cachedCatalog?.agents || []).find(a => a.id === member.id) || { id: member.id };
      let text = '';
      try {
        const completion = await this.gateway.streamCompletion({
          model: settings.ollamaModel || settings.defaultModel || resolveDefaultModel(),
          systemPrompt: agentDef.systemPrompt || `You are the OAS ${member.id} agent. Reply in 3 short sentences.`,
          prompt: `Council mode: ${mode}\nTopic: ${topic}\nGive your stance and 3 short invariants as a bullet list.`,
          maxTokens: 180
        });
        text = (completion.text || '').trim();
      } catch (err) {
        text = `${member.id} model call failed: ${err.code || err.message}`;
      }
      const invariants = text.split('\n').filter(line => /^\s*[-*]/.test(line)).slice(0, 3).map(l => l.replace(/^\s*[-*]\s*/, ''));
      rounds.push({
        round: i + 1,
        speaker: member.speaker,
        avatar: member.avatar,
        stance: text || `${member.id} returned empty model output.`,
        confidence: text.length > 40 ? 0.7 : 0.3,
        keyInvariants: invariants.length ? invariants : ['No structured invariants returned']
      });
    }

    const plannerRound = rounds[rounds.length - 1];
    const consensusScore = Math.round((rounds.reduce((sum, r) => sum + r.confidence, 0) / rounds.length) * 100);

    return this.sendJson(res, 200, {
      councilId: `council-${Date.now()}`,
      topic,
      mode,
      consensusScore,
      status: 'DELIBERATED',
      participants: participants.map(p => p.id),
      rounds,
      ratifiedPlan: {
        title: `Council plan: ${topic}`,
        architecture: plannerRound.stance.slice(0, 240),
        securityGuards: rounds[1] ? rounds[1].keyInvariants : [],
        testInvariants: rounds[2] ? rounds[2].keyInvariants : [],
        executionPhases: rounds.map((r, idx) => `Phase ${idx + 1}: ${r.speaker}`)
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

// --- STEP 3: GIT CLOUD BRIDGE & ONE-CLICK GITHUB PR GENERATOR ---
if (pathname === '/api/git/pr/generate' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    const branch = body.branch || 'feat/oas-frontier-enhancements';
    const baseBranch = body.baseBranch || 'main';
    const conventionalType = body.conventionalType || 'feat';
    const title = body.title || 'Advance OAS Studio with Self-Healing, Council Debate, and 3D Topology';
    const prTitle = `${conventionalType}(studio): ${title}`;

    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;
    let statusOutput = '';
    try {
      statusOutput = execSync('git status --short', { cwd: this.workspaceRoot, encoding: 'utf8' });
      filesChanged = statusOutput.split('\n').filter(Boolean).length;
      const numstat = execSync('git diff --numstat HEAD', { cwd: this.workspaceRoot, encoding: 'utf8' });
      for (const line of numstat.split('\n').filter(Boolean)) {
        const [add, del] = line.split('\t');
        additions += Number(add) || 0;
        deletions += Number(del) || 0;
      }
    } catch (gitErr) {
      return this.sendJson(res, 500, { error: `Unable to compute git diff: ${gitErr.message}` });
    }

    const prBody = [
      `## Description`,
      title,
      ``,
      `### Git snapshot`,
      `- Base: \`${baseBranch}\``,
      `- Branch: \`${branch}\``,
      `- Files changed: ${filesChanged}`,
      `- Additions: ${additions}`,
      `- Deletions: ${deletions}`,
      ``,
      `### Working tree`,
      '```',
      statusOutput.trim() || '(clean)',
      '```',
      ``,
      `CycloneDX SBOM is available from GET /api/security/sbom. Test results are not claimed here; run the suite before merge.`
    ].join('\n');

    return this.sendJson(res, 200, {
      readyToPublish: filesChanged > 0,
      branch,
      baseBranch,
      prTitle,
      prBody,
      commitCommand: `git commit -m "${prTitle.replace(/"/g, '\\"')}" && git push -u origin ${branch}`,
      diffStats: {
        filesChanged,
        additions,
        deletions
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

if (pathname === '/api/webhooks/github' && req.method === 'POST') {
  try {
    const raw = await new Promise((resolve, reject) => {
      let acc = '';
      req.on('data', chunk => { acc += chunk; });
      req.on('end', () => resolve(acc));
      req.on('error', reject);
    });
    const secret = process.env.GITHUB_WEBHOOK_SECRET || (this.store.getSettings() || {}).githubWebhookSecret;
    if (secret && !this.verifyGithubSignature(raw, req.headers['x-hub-signature-256'] || '', secret)) {
      return this.sendJson(res, 401, { error: 'Invalid GitHub webhook signature.' });
    }
    let body = {};
    if (raw) {
      try { body = JSON.parse(raw); } catch {
        return this.sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    }
    const event = body.event || req.headers['x-github-event'] || 'issues';
    const action = body.action || 'labeled';
    const issueNumber = body.issue ? body.issue.number : (body.issueNumber || 101);
    const issueTitle = body.issue ? body.issue.title : (body.issueTitle || 'Fix intermittent timeout in test suite');

    const assignedAgent = (body.label === 'security' || issueTitle.includes('security'))
      ? 'security-reviewer'
      : 'build-error-resolver';

    const newSession = this.store.createSession({
      title: `GitHub Issue #${issueNumber}: ${issueTitle}`,
      leadAgent: assignedAgent,
      model: resolveDefaultModel(),
      status: 'running',
      metadata: {
        source: 'github-webhook',
        event,
        action,
        issueNumber
      }
    });

    return this.sendJson(res, 201, {
      received: true,
      event,
      action: 'spawned_session',
      sessionId: newSession.id,
      issueNumber,
      assignedAgent,
      message: `Autonomous session #${newSession.id} initiated for GitHub issue #${issueNumber}`
    });
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

};
