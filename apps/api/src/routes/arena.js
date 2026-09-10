/**
 * @file apps/api/src/routes/arena.js
 * Arena compare: golden tasks, pass@k, recorded traces.
 */

const { wrapUntrustedContent, redactSecrets } = require('../../../../packages/engine/src/prompt-guard');
const { estimateCostUsd } = require('../../../../packages/engine/src/cost-ledger');
const {
  gradeOutput,
  listGoldenTasks,
  resolveArenaTask,
  summarizeModelEval,
  pickArenaWinners,
  parseCustomGraders,
  gradeWithModelJudge
} = require('../../../../packages/engine/src/eval-harness');

function sanitizeId(value) {
  return String(value || 'model').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
}

function uniqueModels(models) {
  const list = Array.isArray(models) ? models.map(id => String(id || '').trim()).filter(Boolean) : [];
  return [...new Set(list)].slice(0, 5);
}

async function completeAttempt(server, modelId, prompt) {
  const start = Date.now();
  const resolved = server.gateway.resolveProvider ? server.gateway.resolveProvider(modelId) : { provider: 'custom' };
  const providerName = String((resolved && resolved.provider) || 'custom').toUpperCase();
  try {
    const completion = await server.gateway.streamCompletion({
      model: modelId,
      prompt,
      maxTokens: 500
    });
    const text = String((completion && completion.text) || '');
    const tokens = Math.max(1, Math.round(text.length / 4));
    const cost = estimateCostUsd({
      provider: resolved && resolved.provider,
      model: modelId,
      tokens
    });
    return {
      output: text.slice(0, 8000),
      latencyMs: Date.now() - start,
      tokens,
      cost,
      providerName
    };
  } catch (err) {
    return {
      output: '',
      latencyMs: Date.now() - start,
      tokens: 0,
      cost: 0,
      providerName,
      error: err.message || String(err)
    };
  }
}

module.exports = async function arenaRoutes(req, res, pathname, parsedUrl) {
  if (pathname === '/api/arena/tasks' && req.method === 'GET') {
    return this.sendJson(res, 200, {
      schemaVersion: 'oas.arena.v1',
      tasks: listGoldenTasks()
    });
  }

  if (pathname === '/api/arena/traces' && req.method === 'GET') {
    const benchmarkId = parsedUrl && parsedUrl.query
      ? parsedUrl.query.benchmarkId
      : (parsedUrl && parsedUrl.searchParams ? parsedUrl.searchParams.get('benchmarkId') : null);
    const traces = this.store.listArenaTraces ? this.store.listArenaTraces({ benchmarkId }) : [];
    return this.sendJson(res, 200, {
      traces: traces.slice(-50)
    });
  }

  if (pathname === '/api/arena/compare' && req.method === 'POST') {
    try {
      const body = await this.parseBody(req);
      const models = uniqueModels(body.models && body.models.length ? body.models : ['qwen2.5-coder:7b']);
      if (!models.length) {
        return this.sendJson(res, 400, { error: 'Select at least one model', errorCode: 'ARENA_NO_MODELS' });
      }
      const k = Math.min(3, Math.max(1, Math.floor(Number(body.k) || 1)));
      const extraGraders = parseCustomGraders({
        mustContain: body.mustContain,
        mustNotContain: body.mustNotContain
      });
      const customGraders = [
        ...(Array.isArray(body.graders) ? body.graders : []),
        ...extraGraders
      ];
      const useCustom = String(body.taskId || '') === 'custom' || (customGraders.length > 0 && !body.taskId);
      const task = resolveArenaTask({
        taskId: useCustom ? undefined : body.taskId,
        prompt: body.prompt,
        graders: useCustom || (!body.taskId && customGraders.length) ? customGraders : undefined
      });
      const trusted = task.source === 'golden';
      const modelPrompt = trusted
        ? task.prompt
        : wrapUntrustedContent(task.prompt);
      const benchmarkId = `arena-${Date.now()}`;
      const wantJudge = body.judge === true || body.judge === 'true';
      const traces = [];
      const results = [];

      for (const modelId of models) {
        const attempts = [];
        let providerName = 'CUSTOM';
        let lastJudge = null;
        for (let attempt = 1; attempt <= k; attempt++) {
          const raw = await completeAttempt(this, modelId, modelPrompt);
          providerName = raw.providerName;
          const grade = task.graders.length
            ? gradeOutput(raw.output, task.graders)
            : { passed: false, results: [] };
          let judge = null;
          if (wantJudge) {
            judge = await gradeWithModelJudge({
              output: raw.output,
              rubric: task.title || task.prompt,
              complete: opts => this.gateway.streamCompletion({
                model: body.judgeModel || modelId,
                prompt: opts.prompt,
                maxTokens: opts.maxTokens || 80
              })
            });
            lastJudge = judge;
          }
          const codePassed = task.graders.length ? grade.passed : (judge ? judge.passed : false);
          const passed = Boolean(codePassed && (!judge || judge.passed) && !raw.error);
          const trace = {
            id: `tr_${benchmarkId}_${sanitizeId(modelId)}_${attempt}`,
            benchmarkId,
            taskId: task.id,
            modelId,
            attempt,
            passed,
            output: redactSecrets(raw.output),
            error: raw.error || null,
            latencyMs: raw.latencyMs,
            tokens: raw.tokens,
            cost: raw.cost,
            graderResults: grade.results,
            judge,
            createdAt: new Date().toISOString()
          };
          traces.push(trace);
          if (this.store.saveArenaTrace) this.store.saveArenaTrace(trace);
          attempts.push({
            passed,
            latencyMs: raw.latencyMs,
            tokens: raw.tokens,
            cost: raw.cost,
            output: raw.output,
            error: raw.error,
            graderResults: grade.results
          });
        }
        results.push({
          ...summarizeModelEval({
            modelId,
            name: modelId,
            provider: providerName,
            k,
            graders: task.graders,
            graded: task.graders.length > 0 || Boolean(lastJudge),
            attempts
          }),
          judge: lastJudge || undefined
        });
      }

      const capability = (task.graders.length || wantJudge)
        ? 'eval-harness'
        : 'ungraded-trace';
      const scoringMethod = task.graders.length
        ? 'pass_at_k'
        : (wantJudge ? 'model_judge' : 'ungraded_trace');
      return this.sendJson(res, 200, {
        schemaVersion: 'oas.arena.v1',
        benchmarkId,
        prompt: task.prompt,
        timestamp: new Date().toISOString(),
        capability,
        scoringMethod,
        k,
        task: {
          id: task.id,
          title: task.title,
          source: task.source,
          graderCount: task.graders.length
        },
        scoringNote: task.graders.length
          ? `pass@${k} over ${task.graders.length} code grader(s). Traces are recorded.`
          : 'No graders for this prompt. Outputs are recorded traces only, not an eval score.',
        models: results,
        traces,
        winners: pickArenaWinners(results)
      });
    } catch (err) {
      return this.sendJson(res, err.statusCode || 500, {
        error: err.message,
        errorCode: err.code || 'ARENA_COMPARE_FAILED'
      });
    }
  }
};
