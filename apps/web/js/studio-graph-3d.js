/**
 * Shared 3D graph math and visual tokens for Execution DAG topology
 * and Knowledge Graph-style glass spheres.
 * Pure helpers — no DOM except resizeHiDpiCanvas writing canvas.width/height.
 */

export const GRAPH3D_FOV = 720;
export const GRAPH3D_DEFAULT_CAMERA = {
  rotX: 0.32,
  rotY: -0.38,
  fov: GRAPH3D_FOV,
  orbitSpeed: 0.0016
};

const PALETTES = {
  hub: {
    brightColor: '#93C5FD',
    color: '#38BDF8',
    darkColor: '#1E3A8A',
    glowColor: 'rgba(56, 189, 248, 0.7)'
  },
  agent: {
    brightColor: '#6EE7B7',
    color: '#34D399',
    darkColor: '#065F46',
    glowColor: 'rgba(16, 185, 129, 0.6)'
  },
  skill: {
    brightColor: '#FDE68A',
    color: '#FBBF24',
    darkColor: '#78350F',
    glowColor: 'rgba(251, 191, 36, 0.55)'
  }
};

export function topologyPalette(type) {
  return PALETTES[type] || PALETTES.skill;
}

export function projectPerspective3D(x, y, z, camera) {
  const rotX = Number(camera.rotX) || 0;
  const rotY = Number(camera.rotY) || 0;
  const fov = Number(camera.fov) > 0 ? Number(camera.fov) : GRAPH3D_FOV;
  const zoom = Number.isFinite(Number(camera.zoom)) ? Number(camera.zoom) : 1;
  const panX = Number(camera.panX) || 0;
  const panY = Number(camera.panY) || 0;
  const cx = Number(camera.cx) || 0;
  const cy = Number(camera.cy) || 0;

  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);

  const x1 = x * cosY - z * sinY;
  const z1 = z * cosY + x * sinY;
  const y1 = y * cosX - z1 * sinX;
  const z2 = z1 * cosX + y * sinX;
  const scale = fov / (fov + z2 + 250);

  return {
    x: cx + (x1 * scale) * zoom + panX,
    y: cy + (y1 * scale) * zoom + panY,
    z: z2,
    scale: scale * zoom
  };
}

export function centroid3D(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (list.length === 0) return { x: 0, y: 0, z: 0 };
  const sum = list.reduce((acc, node) => ({
    x: acc.x + Number(node.x || 0),
    y: acc.y + Number(node.y || 0),
    z: acc.z + Number(node.z || 0)
  }), { x: 0, y: 0, z: 0 });
  return {
    x: sum.x / list.length,
    y: sum.y / list.length,
    z: sum.z / list.length
  };
}

export function centerAndScaleNodes(nodes, targetRadius = 280) {
  const list = Array.isArray(nodes) ? nodes : [];
  const hub = list.find(node => node && node.type === 'hub');
  const center = hub
    ? { x: Number(hub.x || 0), y: Number(hub.y || 0), z: Number(hub.z || 0) }
    : centroid3D(list);
  const shifted = list.map(node => ({
    ...node,
    x: Number(node.x || 0) - center.x,
    y: Number(node.y || 0) - center.y,
    z: Number(node.z || 0) - center.z
  }));
  const maxR = shifted.reduce((max, node) => Math.max(max, Math.hypot(node.x, node.y, node.z)), 1);
  const scale = targetRadius / maxR;
  return shifted.map(node => ({
    ...node,
    x: node.x * scale,
    y: node.y * scale,
    z: node.z * scale
  }));
}

export function prepareTopologyNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((node, index) => {
    const palette = topologyPalette(node.type);
    const baseRadius = node.type === 'hub' ? 13 : (node.type === 'agent' ? 7.5 : 5.2);
    return {
      ...node,
      ...palette,
      baseX: Number(node.x || 0),
      baseY: Number(node.y || 0),
      baseZ: Number(node.z || 0),
      baseRadius,
      phase: (index * 0.37) % (Math.PI * 2),
      freq: 0.7 + (index % 5) * 0.11
    };
  });
}

export function createSpaceDust(count = 72) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const dust = [];
  for (let i = 0; i < n; i += 1) {
    const seed = (i + 1) * 12.9898;
    const rand = (offset) => {
      const value = Math.sin(seed * (offset + 1.1)) * 43758.5453;
      return value - Math.floor(value);
    };
    dust.push({
      x: (rand(1) - 0.5) * 980,
      y: (rand(2) - 0.5) * 720,
      z: (rand(3) - 0.5) * 860,
      size: 0.7 + rand(4) * 1.6,
      twinkleSpeed: 0.6 + rand(5) * 1.4,
      phase: rand(6) * Math.PI * 2
    });
  }
  return dust;
}

export function resizeHiDpiCanvas(canvas, { width, height, dpr = 1 } = {}) {
  const layoutW = Math.max(1, Math.round(Number(width) || 1));
  const layoutH = Math.max(1, Math.round(Number(height) || 1));
  const ratio = Number(dpr) > 0 ? Number(dpr) : 1;
  if (canvas) {
    canvas.width = Math.round(layoutW * ratio);
    canvas.height = Math.round(layoutH * ratio);
  }
  return { width: layoutW, height: layoutH, dpr: ratio };
}

export function drawNebulaBackdrop(ctx, { width, height, cx, cy, panX = 0, panY = 0, time = 0 }) {
  if (!ctx) return;
  const pulse = 0.38 + 0.1 * Math.sin(time * 0.65);
  const nebula = ctx.createRadialGradient(cx + panX * 0.3, cy + panY * 0.3, 20, cx, cy, Math.max(width, height) * 0.65);
  nebula.addColorStop(0, `rgba(14, 48, 96, ${pulse})`);
  nebula.addColorStop(0.42, 'rgba(8, 22, 48, 0.32)');
  nebula.addColorStop(1, 'rgba(3, 6, 15, 0)');
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, width, height);
}

export function drawGlassSphere(ctx, node, { time = 0, focused = false } = {}) {
  if (!ctx || !node) return;
  const r = Math.max(2.6, Number(node.currentRadius || node.baseRadius || 6) * Number(node.projScale || 1));
  const px = node.projX;
  const py = node.projY;

  ctx.beginPath();
  ctx.arc(px, py, r * (focused ? 3.05 : 2.05), 0, Math.PI * 2);
  const aura = ctx.createRadialGradient(px, py, r * 0.5, px, py, r * (focused ? 3.05 : 2.05));
  aura.addColorStop(0, node.glowColor || 'rgba(56, 189, 248, 0.55)');
  aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = aura;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  const sphere = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.08, px, py, r);
  sphere.addColorStop(0, '#FFFFFF');
  sphere.addColorStop(0.28, node.brightColor || '#93C5FD');
  sphere.addColorStop(0.75, node.color || '#38BDF8');
  sphere.addColorStop(1, node.darkColor || '#1E3A8A');
  ctx.fillStyle = sphere;
  ctx.shadowColor = focused ? '#38BDF8' : (node.color || '#38BDF8');
  ctx.shadowBlur = focused ? 20 : 8;
  ctx.fill();
  ctx.shadowBlur = 0;

  if (focused) {
    const reticleR = r + 8;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(time * 2);
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, reticleR, (i * Math.PI / 2) + 0.2, (i * Math.PI / 2) + 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function drawPillLabel(ctx, node, { focused = false } = {}) {
  if (!ctx || !node) return;
  const label = node.label || node.name || node.id || '';
  if (!label) return;
  const fontSize = Math.max(9, Math.min(12, Math.round(10 * (node.projScale || 1))));
  ctx.font = `${focused ? '700' : '500'} ${fontSize}px "Inter", -apple-system, sans-serif`;
  const textWidth = ctx.measureText(label).width;
  const r = Math.max(2.6, Number(node.currentRadius || node.baseRadius || 6) * Number(node.projScale || 1));
  const pillX = node.projX + r + 6;
  const pillY = node.projY - (fontSize + 7) / 2;
  ctx.fillStyle = focused ? 'rgba(8, 20, 42, 0.92)' : 'rgba(5, 10, 22, 0.78)';
  ctx.strokeStyle = focused ? 'rgba(56, 189, 248, 0.55)' : 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 1;
  const pillW = textWidth + 12;
  const pillH = fontSize + 7;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillW, pillH, 4);
  } else {
    ctx.rect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#F8FAFC';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, pillX + 6, node.projY);
}
