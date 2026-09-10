/**
 * @file packages/engine/src/bill-of-materials.js
 * CycloneDX SBOM and OAS AIPOM generated from lockfile, catalog, and model registry.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MODEL_RECORDS, resolveDefaultModel } = require('./model-registry');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function componentNameFromLockKey(pkgKey, meta) {
  if (meta && meta.name) return meta.name;
  const cleaned = String(pkgKey).replace(/^node_modules\//, '');
  const nested = cleaned.split('/node_modules/').pop();
  return nested;
}

function buildCycloneDxSbom({ workspaceRoot } = {}) {
  const root = workspaceRoot || process.cwd();
  const pkg = readJson(path.join(root, 'package.json'));
  const lockPath = path.join(root, 'package-lock.json');
  const lock = fs.existsSync(lockPath) ? readJson(lockPath) : { packages: {} };
  const packages = lock.packages || {};
  const components = [];
  const seen = new Set();

  for (const [pkgKey, meta] of Object.entries(packages)) {
    if (!pkgKey || !meta || !meta.version) continue;
    const name = componentNameFromLockKey(pkgKey, meta);
    if (!name) continue;
    const key = `${name}@${meta.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push({
      type: 'library',
      name,
      version: meta.version,
      purl: `pkg:npm/${name}@${meta.version}`,
      scope: meta.dev ? 'optional' : 'required'
    });
  }

  const directPurls = Object.entries(pkg.dependencies || {}).map(([name, spec]) => {
    const version = String(spec).replace(/^[\^~>=<\s]+/, '');
    return `pkg:npm/${name}@${version}`;
  });

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'OAS', name: 'oas-sbom', version: pkg.version }],
      component: {
        name: pkg.name,
        version: pkg.version,
        type: 'application',
        purl: `pkg:npm/${pkg.name}@${pkg.version}`
      }
    },
    components,
    dependencies: [
      {
        ref: `pkg:npm/${pkg.name}@${pkg.version}`,
        dependsOn: directPurls
      }
    ]
  };
}

function buildAipom({ catalog = {}, settings = {}, packageJson = {} } = {}) {
  const agents = Array.isArray(catalog.agents) ? catalog.agents : [];
  const skills = Array.isArray(catalog.skills) ? catalog.skills : [];
  const commands = Array.isArray(catalog.commands) ? catalog.commands : [];
  const configuredModel = settings.ollamaModel || settings.defaultModel || resolveDefaultModel();

  return {
    schemaVersion: 'oas.aipom.v1',
    generatedAt: new Date().toISOString(),
    source: 'catalog+model-registry+settings',
    system: {
      name: packageJson.name || 'oas-universal',
      version: packageJson.version || '0.0.0'
    },
    configuredModel,
    models: Object.entries(MODEL_RECORDS).map(([modelId, record]) => ({
      modelId,
      provider: record.provider,
      contextWindow: record.contextWindow
    })),
    agents: {
      count: agents.length,
      ids: agents.map(agent => agent.id || agent.name).filter(Boolean)
    },
    skills: {
      count: skills.length
    },
    commands: {
      count: commands.length
    },
    guardrailPolicies: {
      sandboxEnabled: settings.sandboxEnabled !== false,
      worktreeIsolation: settings.worktreeIsolation !== false
    }
  };
}

module.exports = {
  buildCycloneDxSbom,
  buildAipom
};
