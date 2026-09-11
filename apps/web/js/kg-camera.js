/**
 * Knowledge Graph camera math and honest live-activity helpers.
 * Pure functions — no DOM. Projection: screen = center + world * zoom + pan.
 */

export const KG_ZOOM_MIN = 0.28;
export const KG_ZOOM_MAX = 6.5;

export function clampKgZoom(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value)) return 1;
  return Math.max(KG_ZOOM_MIN, Math.min(KG_ZOOM_MAX, value));
}

export function computeZoomPan({
  cursorX,
  cursorY,
  centerX,
  centerY,
  panX,
  panY,
  zoom,
  nextZoom
}) {
  const currentZoom = clampKgZoom(zoom);
  const targetZoom = clampKgZoom(nextZoom);
  if (currentZoom === 0 || targetZoom === currentZoom) {
    return { zoom: targetZoom, panX, panY };
  }
  const ratio = targetZoom / currentZoom;
  return {
    zoom: targetZoom,
    panX: cursorX - centerX - (cursorX - centerX - panX) * ratio,
    panY: cursorY - centerY - (cursorY - centerY - panY) * ratio
  };
}

export function wheelZoomFactor(deltaY, deltaMode = 0, { pinch = false } = {}) {
  const lineScale = deltaMode === 1 ? 16 : (deltaMode === 2 ? 48 : 1);
  const dy = Math.max(-180, Math.min(180, Number(deltaY) * lineScale));
  const sensitivity = pinch ? 0.0009 : 0.00115;
  return Math.exp(-dy * sensitivity);
}

export function formatKgZoomPercent(zoom) {
  return `${Math.round(clampKgZoom(zoom) * 100)}%`;
}

export function nodeIdentityAliases(node) {
  if (!node) return [];
  const raw = [node.id, node.name, node.entityId, node.leadAgent]
    .filter(Boolean)
    .map(value => String(value));
  const aliases = new Set();
  raw.forEach(value => {
    aliases.add(value);
    aliases.add(value.toLowerCase());
    const stripped = value.replace(/^(agent|skill|command|mcp):/i, '');
    aliases.add(stripped);
    aliases.add(stripped.toLowerCase());
  });
  return [...aliases];
}

export function matchLiveAgent(node, activeAgents) {
  if (!node || !Array.isArray(activeAgents) || activeAgents.length === 0) return false;
  const aliases = new Set(nodeIdentityAliases(node));
  return activeAgents.some(agent => {
    if (agent == null || agent === '') return false;
    const value = String(agent);
    if (aliases.has(value) || aliases.has(value.toLowerCase())) return true;
    const stripped = value.replace(/^(agent|skill|command|mcp):/i, '');
    return aliases.has(stripped) || aliases.has(stripped.toLowerCase());
  });
}

export function isKgNodeEnergized(node, activeAgents, localActivity, now) {
  if (matchLiveAgent(node, activeAgents)) return 'live';
  if (!node || !localActivity || typeof localActivity.get !== 'function') return null;
  const pulse = localActivity.get(node.id);
  if (pulse && Number(pulse.until) > Number(now)) return pulse.kind || 'pulse';
  return null;
}

export function formatKgRunCount(metric) {
  if (!metric || !Number.isFinite(Number(metric.runs))) return '—';
  return String(metric.runs);
}

export function formatKgLatency(metric) {
  if (!metric || !Number.isFinite(Number(metric.avgLatencyMs))) return '—';
  return `${Math.round(Number(metric.avgLatencyMs))}ms`;
}

export function createEdgeBurstPhotons(edges, nodeId, { max = 14 } = {}) {
  if (!Array.isArray(edges) || !nodeId) return [];
  const matched = [];
  edges.forEach((edge, index) => {
    if (edge && (edge.source === nodeId || edge.target === nodeId)) {
      matched.push(index);
    }
  });
  return matched.slice(0, max).map((edgeIndex, i) => ({
    edgeIndex,
    progress: 0,
    speed: 0.014 + i * 0.0016,
    size: 2.7 + (i % 3) * 0.25,
    burst: true
  }));
}

export function pruneKgPhotons(photons, { max = 140 } = {}) {
  const kept = (photons || []).filter(photon => !photon.burst || photon.progress < 1);
  if (kept.length <= max) return kept;
  return kept.slice(kept.length - max);
}
