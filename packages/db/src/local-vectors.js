/**
 * @file packages/db/src/local-vectors.js
 * Deterministic local hash vectors. Not pgvector / not hosted embeddings.
 */

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 1)
    .slice(0, 400);
}

function embedText(text, dimensions = 64) {
  const vector = new Array(dimensions).fill(0);
  for (const token of tokenize(text)) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => value / norm);
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return 0;
  let dot = 0;
  for (let i = 0; i < left.length; i++) dot += left[i] * right[i];
  return Number(dot.toFixed(6));
}

function rankByLocalVector(records, query) {
  const qv = embedText(query);
  return (Array.isArray(records) ? records : [])
    .map(record => {
      const text = `${record.title || ''} ${record.body || record.content || ''}`;
      return {
        ...record,
        similarity: cosineSimilarity(qv, embedText(text)),
        vectorSource: 'local-hash-vectors'
      };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

module.exports = {
  embedText,
  cosineSimilarity,
  rankByLocalVector
};
