/**
 * @file packages/engine/src/eval-harness.js
 * Code-based graders, pass@k, golden tasks, and Arena winner selection.
 */

const ALLOWED_GRADER_TYPES = new Set(['contains', 'notContains', 'containsAny', 'regex']);

const GOLDEN_TASKS = [
  {
    id: 'ready-token',
    title: 'Reply READY',
    prompt: 'Reply with the single word READY and nothing else.',
    graders: [{ type: 'contains', value: 'READY' }]
  },
  {
    id: 'rate-limiter-tdd',
    title: 'Immutable Rate Limiter (TDD + Spec)',
    prompt: 'Design an immutable thread-safe rate limiter with test-driven coverage.',
    graders: [
      { type: 'containsAny', values: ['rate', 'limit', 'token bucket', 'leaky'] },
      { type: 'containsAny', values: ['test', 'assert', 'describe', 'it('] }
    ]
  },
  {
    id: 'state-reducer',
    title: 'Pure Functional State Reducer',
    prompt: 'Write a pure functional state reducer that returns a new state object and never mutates the previous state.',
    graders: [
      { type: 'containsAny', values: ['reducer', 'spread', '...state', 'Object.assign'] },
      { type: 'notContains', value: 'state.count++' }
    ]
  },
  {
    id: 'immutability-spread',
    title: 'Immutable object update',
    prompt: 'Show how to update {count: 1} to count 2 by returning a new object. Do not mutate.',
    graders: [
      { type: 'containsAny', values: ['...', 'Object.assign', 'structuredClone'] },
      { type: 'notContains', value: 'obj.count = 2' }
    ]
  }
];

const PRESET_ALIASES = {
  rate_limiter: 'rate-limiter-tdd',
  state_reducer: 'state-reducer',
  ast_analyzer: 'immutability-spread',
  tcas_resolver: 'state-reducer'
};

function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) {
    result = (result * (n - kk + i)) / i;
  }
  return result;
}

function passAtK(n, c, k) {
  const trials = Math.max(0, Math.floor(Number(n) || 0));
  const correct = Math.max(0, Math.floor(Number(c) || 0));
  let sample = Math.max(0, Math.floor(Number(k) || 0));
  if (trials <= 0 || sample <= 0 || correct <= 0) return 0;
  if (sample > trials) sample = trials;
  if (trials - correct < sample) return 1;
  const denom = combinations(trials, sample);
  if (!denom) return 0;
  return Number((1 - combinations(trials - correct, sample) / denom).toFixed(4));
}

function normalizeGraders(graders) {
  if (!Array.isArray(graders)) return [];
  return graders.slice(0, 8).map(grader => {
    const type = String(grader && grader.type ? grader.type : '').trim();
    if (!ALLOWED_GRADER_TYPES.has(type)) return null;
    if (type === 'containsAny') {
      const values = Array.isArray(grader.values) ? grader.values.map(v => String(v).slice(0, 80)).filter(Boolean).slice(0, 12) : [];
      if (!values.length) return null;
      return { type, values };
    }
    const value = String(grader.value == null ? '' : grader.value).slice(0, 200);
    if (!value) return null;
    if (type === 'regex') {
      if (value.length > 120 || /\(\?/.test(value)) return null;
      const flags = String(grader.flags || '').replace(/[^gimsuy]/g, '').slice(0, 5);
      try {
        RegExp(value, flags);
      } catch {
        return null;
      }
      return { type, value, flags };
    }
    return {
      type,
      value,
      ignoreCase: Boolean(grader.ignoreCase)
    };
  }).filter(Boolean);
}

function gradeOutput(output, graders = []) {
  const text = String(output || '');
  const list = normalizeGraders(graders);
  if (!list.length) {
    return { passed: false, results: [] };
  }
  const results = list.map(grader => {
    let passed = false;
    if (grader.type === 'contains') {
      passed = grader.ignoreCase
        ? text.toLowerCase().includes(grader.value.toLowerCase())
        : text.includes(grader.value);
    } else if (grader.type === 'notContains') {
      passed = grader.ignoreCase
        ? !text.toLowerCase().includes(grader.value.toLowerCase())
        : !text.includes(grader.value);
    } else if (grader.type === 'containsAny') {
      passed = grader.values.some(value => text.toLowerCase().includes(String(value).toLowerCase()));
    } else if (grader.type === 'regex') {
      passed = new RegExp(grader.value, grader.flags || '').test(text);
    }
    return { type: grader.type, passed, expected: grader.value || grader.values };
  });
  return { passed: results.every(item => item.passed), results };
}

function listGoldenTasks() {
  return GOLDEN_TASKS.map(task => ({
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    graderCount: task.graders.length
  }));
}

function resolveArenaTask(input = {}) {
  const prompt = String(input.prompt || '').slice(0, 4000);
  const requestGraders = normalizeGraders(input.graders);
  if (requestGraders.length) {
    return {
      id: String(input.taskId || 'custom').slice(0, 80) || 'custom',
      title: 'Custom graded prompt',
      prompt: prompt || 'Custom prompt',
      graders: requestGraders,
      source: 'request'
    };
  }
  const requested = String(input.taskId || '').trim();
  const aliased = PRESET_ALIASES[requested] || requested;
  const byId = GOLDEN_TASKS.find(task => task.id === aliased);
  if (byId) {
    return {
      ...byId,
      prompt: prompt || byId.prompt,
      source: 'golden'
    };
  }
  const byPrompt = GOLDEN_TASKS.find(task => task.prompt === prompt);
  if (byPrompt) {
    return { ...byPrompt, source: 'golden' };
  }
  return {
    id: 'ungraded',
    title: 'Ungraded prompt',
    prompt: prompt || GOLDEN_TASKS[0].prompt,
    graders: [],
    source: 'ungraded'
  };
}

function summarizeModelEval(input = {}) {
  const attempts = Array.isArray(input.attempts) ? input.attempts : [];
  const k = Math.max(1, Math.floor(Number(input.k) || 1));
  const n = attempts.length;
  const c = attempts.filter(attempt => attempt && attempt.passed).length;
  const method = input.graded === true || (Array.isArray(input.graders) && input.graders.length)
    ? 'pass_at_k'
    : 'ungraded_trace';
  const tokens = attempts.reduce((sum, attempt) => sum + (Number(attempt.tokens) || 0), 0);
  const cost = attempts.reduce((sum, attempt) => sum + (Number(attempt.cost) || 0), 0);
  const latencyMs = attempts.reduce((max, attempt) => Math.max(max, Number(attempt.latencyMs) || 0), 0);
  const last = attempts[attempts.length - 1] || {};
  const passK = method === 'pass_at_k' ? passAtK(n, c, k) : 0;
  return {
    modelId: input.modelId,
    name: input.name || input.modelId,
    provider: input.provider || 'CUSTOM',
    latencyMs,
    tokens,
    cost: Number(cost.toFixed(6)),
    trials: n,
    correct: c,
    k,
    passAtK: passK,
    passAt1: method === 'pass_at_k' ? passAtK(n, c, 1) : 0,
    scoringMethod: method,
    scoreReasoning: method === 'pass_at_k' ? Number((passK * 10).toFixed(1)) : 0,
    scoreAdherence: method === 'pass_at_k' ? Number(((n ? c / n : 0) * 10).toFixed(1)) : 0,
    codeSnippet: String(last.output || last.error || '').slice(0, 4000),
    error: input.error || last.error || undefined,
    attempts: attempts.map(attempt => ({
      passed: Boolean(attempt.passed),
      latencyMs: attempt.latencyMs || 0,
      tokens: attempt.tokens || 0
    }))
  };
}

function pickArenaWinners(models) {
  const list = Array.isArray(models) ? models : [];
  const graded = list.filter(model => model && model.scoringMethod === 'pass_at_k' && !model.error);
  const valid = list.filter(model => model && !model.error && (model.tokens > 0 || model.trials > 0));
  const pool = valid.length ? valid : list;
  const fastest = pool.reduce((best, model) => {
    if (!best) return model;
    return (model.latencyMs || Infinity) < (best.latencyMs || Infinity) ? model : best;
  }, pool[0]);
  const cheapest = pool.reduce((best, model) => {
    if (!best) return model;
    return (model.cost || 0) < (best.cost || 0) ? model : best;
  }, pool[0]);
  const smartest = graded.reduce((best, model) => {
    if (!best) return model;
    if ((model.passAtK || 0) !== (best.passAtK || 0)) {
      return (model.passAtK || 0) > (best.passAtK || 0) ? model : best;
    }
    if ((model.passAt1 || 0) !== (best.passAt1 || 0)) {
      return (model.passAt1 || 0) > (best.passAt1 || 0) ? model : best;
    }
    return (model.correct || 0) > (best.correct || 0) ? model : best;
  }, graded[0]);
  return {
    speedWinner: fastest && fastest.name ? fastest.name : 'None',
    reasoningWinner: smartest && smartest.name ? smartest.name : 'n/a (ungraded)',
    costEfficiencyWinner: cheapest && cheapest.name ? cheapest.name : 'None'
  };
}

function parseCustomGraders(input = {}) {
  const mustContain = String(input.mustContain || '').split(',').map(part => part.trim()).filter(Boolean).slice(0, 8);
  const mustNotContain = String(input.mustNotContain || '').split(',').map(part => part.trim()).filter(Boolean).slice(0, 8);
  return [
    ...mustContain.map(value => ({ type: 'contains', value: value.slice(0, 80), ignoreCase: true })),
    ...mustNotContain.map(value => ({ type: 'notContains', value: value.slice(0, 80), ignoreCase: true }))
  ];
}

async function gradeWithModelJudge(input = {}) {
  const complete = input.complete;
  if (typeof complete !== 'function') {
    return { passed: false, type: 'modelJudge', error: 'complete function required' };
  }
  const { wrapUntrustedContent } = require('./prompt-guard');
  const rubric = String(input.rubric || 'PASS if the output satisfies the task. FAIL otherwise.').slice(0, 500);
  const output = String(input.output || '').slice(0, 4000);
  const prompt = [
    'You are a deterministic eval grader. Reply with PASS or FAIL on the first line, then one sentence.',
    `Rubric: ${rubric}`,
    wrapUntrustedContent(output)
  ].join('\n');
  try {
    const completion = await complete({ prompt, maxTokens: 80 });
    const text = String((completion && completion.text) || '');
    const passed = /^\s*PASS\b/i.test(text);
    return {
      passed,
      type: 'modelJudge',
      output: text.slice(0, 500)
    };
  } catch (err) {
    return { passed: false, type: 'modelJudge', error: err.message || String(err) };
  }
}

module.exports = {
  ALLOWED_GRADER_TYPES,
  GOLDEN_TASKS,
  passAtK,
  combinations,
  normalizeGraders,
  gradeOutput,
  listGoldenTasks,
  resolveArenaTask,
  summarizeModelEval,
  pickArenaWinners,
  parseCustomGraders,
  gradeWithModelJudge
};
