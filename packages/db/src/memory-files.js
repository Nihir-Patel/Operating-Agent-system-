/**
 * @file packages/db/src/memory-files.js
 * Read file-first OAS memory documents so Studio can unify SQLite + vault files.
 */

const fs = require('fs');
const path = require('path');

function parseFrontmatter(raw) {
  const match = String(raw || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: String(raw || '').trim() };
  }
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, body: match[2].replace(/^\s*# [^\n]+\n+/, '').trim() };
}

function collectMarkdownFiles(dir, acc = []) {
  if (!dir || !fs.existsSync(dir)) return acc;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function recordFromFile(filePath, memoryRoot) {
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(raw);
  const rel = memoryRoot ? path.relative(memoryRoot, filePath) : filePath;
  const scopeFromPath = rel.split(path.sep)[0] || 'project';
  const id = meta.id || path.basename(filePath, '.md');
  const title = meta.title || id;
  const kind = meta.kind || meta.category || 'convention';
  const scope = meta.scope || scopeFromPath;
  return {
    id,
    key: id,
    scope,
    kind,
    category: kind,
    title,
    body: body || '',
    content: body || '',
    trust: meta.trust || 'unreviewed',
    hash: meta.hash || '',
    sha256: meta.hash || '',
    created_at: meta.created_at || null,
    updated_at: meta.updated_at || meta.created_at || null,
    source: 'file'
  };
}

function loadFileMemories(memoryRoot) {
  if (!memoryRoot) return [];
  const files = collectMarkdownFiles(memoryRoot);
  const records = [];
  for (const filePath of files) {
    const record = recordFromFile(filePath, memoryRoot);
    if (record) records.push(record);
  }
  return records;
}

function mergeMemoryRecords(dbRecords, fileRecords) {
  const byId = new Map();
  for (const record of fileRecords || []) {
    if (record && record.id) byId.set(record.id, record);
  }
  for (const record of dbRecords || []) {
    if (!record || !record.id) continue;
    const existing = byId.get(record.id);
    byId.set(record.id, existing ? { ...existing, ...record, source: record.source || 'store' } : { ...record, source: record.source || 'store' });
  }
  return Array.from(byId.values());
}

const SEMANTIC_MAP = {
  test: ['coverage', 'tdd', 'unit', 'integration', 'assertion'],
  security: ['sandbox', 'secret', 'credential', 'auth', 'loopback', 'guard'],
  architecture: ['pattern', 'immutability', 'structure', 'modular', 'contract'],
  spec: ['brownfield', 'requirement', 'extraction', 'srs', 'invariant'],
  error: ['exception', 'fail', 'crash', 'rollback', 'checkpoint']
};

function filterMemories(records, query) {
  if (!query) return records;
  const q = String(query).toLowerCase().trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const expandedTerms = new Set(terms);
  for (const term of terms) {
    for (const [concept, synonyms] of Object.entries(SEMANTIC_MAP)) {
      if (concept.includes(term) || term.includes(concept)) {
        synonyms.forEach(s => expandedTerms.add(s));
      } else if (synonyms.some(s => s.includes(term) || term.includes(s))) {
        expandedTerms.add(concept);
        synonyms.forEach(s => expandedTerms.add(s));
      }
    }
  }

  return records
    .map(m => {
      let score = 0;
      const title = (m.title || '').toLowerCase();
      const body = (m.body || m.content || '').toLowerCase();
      const scope = (m.scope || '').toLowerCase();
      const kind = (m.kind || m.category || '').toLowerCase();
      if (title.includes(q)) score += 10;
      if (body.includes(q)) score += 6;
      for (const term of expandedTerms) {
        if (title.includes(term)) score += 4;
        if (body.includes(term)) score += 2;
        if (scope.includes(term)) score += 3;
        if (kind.includes(term)) score += 3;
      }
      return { item: m, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => ({ ...s.item, semanticScore: s.score }));
}

module.exports = {
  parseFrontmatter,
  loadFileMemories,
  mergeMemoryRecords,
  filterMemories
};
