/**
 * @file apps/api/src/routes/llm-ops.js
 * Route handlers bound to OasControlPlaneServer via .call(server)
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { isInsideWorkspace } = require('../../../../packages/engine/src/path-guard');
const { resolveDefaultModel } = require('../../../../packages/engine/src/model-registry');
const { fromGithubWebhook } = require('../../../../packages/engine/src/work-inbox');
const { formatGithubSessionTitle } = require('../../../../packages/engine/src/studio-labels');
const { resolveSandboxedSpawn, isOsIsolationUnavailable } = require('../../../../packages/engine/src/os-sandbox');
const { isLiveLlmUnavailable } = require('../../../../packages/engine/src/llm-gateway');

module.exports = async function llmOpsRoutes(req, res, pathname, _parsedUrl) {
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
    let launched = resolveSandboxedSpawn(cmd, targetCwd);
    let retriedWithoutOsJail = false;

    res.oasPending = true;
    const spawnEnv = {
      ...process.env,
      PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}`
    };

    const runAttempt = (attempt) => {
      const child = spawn(attempt.file, attempt.args, {
        cwd: targetCwd,
        env: spawnEnv
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const killer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already exited */ }
      }, timeoutMs);
      const cleanupProfile = () => {
        if (attempt.profileFile) {
          try { fs.unlinkSync(attempt.profileFile); } catch { /* tmp profile */ }
        }
      };
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(killer);
        cleanupProfile();
        return this.sendJson(res, 200, payload);
      };
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('close', (code) => {
        const exitCode = code == null ? 1 : code;
        if (
          !retriedWithoutOsJail
          && isOsIsolationUnavailable(attempt.isolation, exitCode, stderr)
        ) {
          retriedWithoutOsJail = true;
          settled = true;
          clearTimeout(killer);
          cleanupProfile();
          const fallback = resolveSandboxedSpawn(cmd, targetCwd, {
            sandboxExecPath: null,
            bwrapPath: null
          });
          return runAttempt(fallback);
        }
        return finish({
          command: cmd,
          exitCode,
          stdout: stdout.slice(0, 1024 * 1024 * 2),
          stderr: stderr.slice(0, 1024 * 1024 * 2),
          durationMs: Date.now() - startTime,
          success: exitCode === 0,
          isolation: attempt.isolation,
          isolationFallback: retriedWithoutOsJail ? 'os-jail-denied' : undefined,
          timestamp: new Date().toISOString()
        });
      });
      child.on('error', (error) => {
        return finish({
          command: cmd,
          exitCode: 1,
          stdout: '',
          stderr: error.message,
          durationMs: Date.now() - startTime,
          success: false,
          isolation: attempt.isolation,
          timestamp: new Date().toISOString()
        });
      });
    };

    runAttempt(launched);
    return;
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

if (pathname === '/api/loop/heal/merge' && req.method === 'POST') {
  try {
    const body = await this.parseBody(req);
    if (!body.confirmMerge) {
      return this.sendJson(res, 400, {
        error: 'HITL confirmMerge is required before merging a heal worktree',
        errorCode: 'HITL_REQUIRED'
      });
    }
    const worktreeId = body.worktreeId;
    if (!worktreeId) {
      return this.sendJson(res, 400, { error: 'worktreeId is required' });
    }
    const result = this.worktrees.mergeWorktree(worktreeId, body.targetBranch || 'HEAD');
    if (result.success) {
      this.worktrees.removeWorktree(worktreeId);
    }
    return this.sendJson(res, result.success ? 200 : 409, {
      ...result,
      merged: Boolean(result.success)
    });
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

    let errorType = 'RuntimeError';
    let extractedFile = String(targetFile || '').replace(/^\/+/, '');
    let lineNum = 1;

    if (errorTrace.includes('SyntaxError')) errorType = 'SyntaxError';
    else if (errorTrace.includes('TypeError')) errorType = 'TypeError';
    else if (errorTrace.includes('AssertionError')) errorType = 'AssertionError';
    else if (errorTrace.includes('ReferenceError')) errorType = 'ReferenceError';

    const lineMatch = errorTrace.match(/(?:^|[\s(])([A-Za-z0-9_\-./]+):(\d+):(\d+)/);
    if (lineMatch) {
      if (!extractedFile) extractedFile = lineMatch[1];
      lineNum = parseInt(lineMatch[2], 10);
    }

    const suggestedPatch = `// Heuristic template — not an LLM patch\n// Classified ${errorType} at line ${lineNum}\ntry {\n  /* review this block before applying */\n} catch (guardErr) {\n  console.warn('[OAS Self-Heal Guard]', guardErr.message);\n}`;
    const diff = `--- a/${extractedFile}\n+++ b/${extractedFile}\n@@ -${lineNum},3 +${lineNum},7 @@\n-${errorTrace.split('\n')[0] || '// offending code line'}\n+${suggestedPatch.split('\n').join('\n+')}`;

    const base = {
      resolved: true,
      errorType,
      extractedFile,
      lineNum,
      failedCommand: failedCmd,
      patchSummary: `Diagnosed ${errorType} in ${path.basename(extractedFile) || 'unknown file'} (line ${lineNum})`,
      suggestedPatch,
      diff,
      applied: false,
      appliedInWorktree: false,
      verified: false,
      generatedBy: 'heuristic-template',
      agent: 'build-error-resolver',
      timestamp: new Date().toISOString()
    };

    if (!body.apply) {
      return this.sendJson(res, 200, {
        ...base,
        capability: 'suggest-only',
        applyDisabled: true,
        verificationOutput: 'Patch is a suggestion only. It was not applied or verified.'
      });
    }

    const { applyHealInWorktree, verifyHealWorktree } = require('../../../../packages/engine/src/heal-apply');
    const healId = 'heal_' + Date.now().toString(36);
    const worktree = this.worktrees.spawnWorktree(healId, 'build-error-resolver');
    const applyResult = applyHealInWorktree({
      worktreePath: worktree.path,
      healId,
      targetFile: extractedFile,
      suggestedPatch,
      diff,
      errorType,
      replaceContent: body.replaceContent
    });

    try {
      this.leases.acquire({
        holderId: 'build-error-resolver',
        paths: [extractedFile || '.oas/heals'],
        sessionId: healId
      });
    } catch {
      // Lease may already exist for this healer; continue.
    }

    const verifyCommand = body.verifyCommand || 'true';
    const verification = verifyHealWorktree(worktree.path, verifyCommand, this.sandbox);

    return this.sendJson(res, 200, {
      ...base,
      capability: 'worktree-apply',
      applied: false,
      appliedInWorktree: true,
      applyDisabled: false,
      mergeReady: Boolean(verification.verified),
      verified: Boolean(verification.verified),
      verificationOutput: verification.output,
      worktree: {
        id: worktree.id,
        path: worktree.path,
        branch: worktree.branch,
        status: worktree.status
      },
      artifactDir: applyResult.artifactDir,
      written: applyResult.written
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
      { id: 'architect', speaker: 'Architect (architect)', avatar: 'AR' },
      { id: 'security-reviewer', speaker: 'Security Reviewer (security-reviewer)', avatar: 'SR' },
      { id: 'tdd-guide', speaker: 'TDD Guide (tdd-guide)', avatar: 'TD' },
      { id: 'planner', speaker: 'Planner (planner)', avatar: 'PL' }
    ];

    const settings = this.store.getSettings() || {};
    const rounds = [];
    let live = true;
    let liveError = null;
    for (const [i, member] of participants.entries()) {
      const agentDef = (this.cachedCatalog?.agents || []).find(a => a.id === member.id) || { id: member.id };
      let text = '';
      if (!live) {
        text = `${member.id} skipped live model (${liveError && (liveError.code || liveError.message)}). Configure BYOK or Ollama in Settings.\n- No live model for ${member.id}\n- Topic remains: ${topic}\n- Fail-closed after the first unreachable provider`;
      } else {
        try {
          const completion = await this.gateway.streamCompletion({
            model: settings.ollamaModel || settings.defaultModel || resolveDefaultModel(),
            systemPrompt: agentDef.systemPrompt || `You are the OAS ${member.id} agent. Reply in 3 short sentences.`,
            prompt: `Council mode: ${mode}\nTopic: ${topic}\nGive your stance and 3 short invariants as a bullet list.`,
            maxTokens: 180,
            timeoutMs: Math.min(Number(body.timeoutMs) || 5000, 15000)
          });
          text = (completion.text || '').trim();
        } catch (err) {
          text = `${member.id} model call failed: ${err.code || err.message}`;
          if (isLiveLlmUnavailable(err)) {
            live = false;
            liveError = err;
          }
        }
      }
      const invariants = text.split('\n').filter(line => /^\s*[-*]/.test(line)).slice(0, 3).map(l => l.replace(/^\s*[-*]\s*/, ''));
      rounds.push({
        round: i + 1,
        speaker: member.speaker,
        avatar: member.avatar,
        stance: text || `${member.id} returned empty model output.`,
        confidence: live && text.length > 40 ? 0.7 : 0.3,
        keyInvariants: invariants.length ? invariants : ['No structured invariants returned']
      });
    }

    const plannerRound = rounds[rounds.length - 1];
    const consensusScore = Math.round((rounds.reduce((sum, r) => sum + r.confidence, 0) / rounds.length) * 100);

    return this.sendJson(res, 200, {
      councilId: `council-${Date.now()}`,
      topic,
      mode,
      live,
      liveError: liveError ? (liveError.code || liveError.message) : undefined,
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
    try {
      await this.parseBody(req);
    } catch (err) {
      if (err.code !== 'INVALID_JSON') throw err;
    }
    const raw = req._oasRawBody || '';
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
    const issue = body.issue && typeof body.issue === 'object' ? body.issue : null;
    const issueNumber = issue && issue.number != null ? issue.number : (body.issueNumber != null ? body.issueNumber : null);
    const issueTitle = (issue && issue.title)
      || body.issueTitle
      || (issueNumber != null ? 'Untitled issue' : 'Webhook received (no issue payload)');
    const htmlUrl = (issue && (issue.html_url || issue.url)) || body.html_url || '';
    const sample = !/^https:\/\/github\.com\//i.test(String(htmlUrl));

    const assignedAgent = (body.label === 'security' || String(issueTitle).includes('security'))
      ? 'security-reviewer'
      : 'build-error-resolver';

    const newSession = this.store.createSession({
      title: formatGithubSessionTitle({ issueNumber, issueTitle, sample }),
      lead_agent_id: assignedAgent,
      model: resolveDefaultModel(),
      status: 'running',
      metadata: {
        source: 'github-webhook',
        event,
        action,
        issueNumber,
        sample
      }
    });

    let workItemId = null;
    if (this.store.saveWorkItem) {
      const workItem = fromGithubWebhook({
        ...body,
        issue: issue || { number: issueNumber, title: issueTitle, html_url: htmlUrl }
      });
      const saved = this.store.saveWorkItem({ ...workItem, sessionId: newSession.id, sample });
      workItemId = saved && saved.id;
    }

    return this.sendJson(res, 201, {
      received: true,
      event,
      action: 'spawned_session',
      sessionId: newSession.id,
      issueNumber,
      assignedAgent,
      workItemId,
      message: `Autonomous session #${newSession.id} initiated for GitHub issue #${issueNumber}`
    });
  } catch (err) {
    return this.sendJson(res, 500, { error: err.message });
  }
}

};
