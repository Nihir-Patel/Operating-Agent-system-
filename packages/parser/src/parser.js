const fs = require('fs');
const path = require('path');

function parseYamlFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { fm: {}, body: content };
  const lines = match[1].split('\n');
  const result = {};
  let currentKey = null;

  for (const line of lines) {
    const listMatch = line.match(/^\s*-\s*(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      let itemVal = listMatch[1].trim();
      if ((itemVal.startsWith('"') && itemVal.endsWith('"')) || (itemVal.startsWith("'") && itemVal.endsWith("'"))) {
        itemVal = itemVal.slice(1, -1);
      }
      result[currentKey].push(itemVal);
      continue;
    }

    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      let val = kv[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val === '') {
        result[currentKey] = [];
      } else {
        result[currentKey] = val;
      }
    }
  }
  return { fm: result, body: content.slice(match[0].length).trim() };
}

function classifyAgentCluster(name) {
  if (name.includes('build-resolver') || name.includes('app-resolver')) {
    return 'build_resolvers';
  } else if (
    name.includes('reviewer') ||
    name.includes('simplifier') ||
    name.includes('analyzer') ||
    name.includes('evaluator') ||
    name.includes('cleaner')
  ) {
    return 'quality_and_review';
  } else if (
    name.includes('architect') ||
    name.includes('planner') ||
    name.includes('spec-miner') ||
    name.includes('tdd-guide')
  ) {
    return 'architecture_and_planning';
  } else if (
    name.includes('operator') ||
    name.includes('optimizer') ||
    name.includes('hunter') ||
    name.includes('explorer') ||
    name.includes('forker') ||
    name.includes('packager') ||
    name.includes('sanitizer') ||
    name.includes('updater') ||
    name.includes('lookup') ||
    name.includes('runner')
  ) {
    return 'operations_and_meta';
  }
  return 'specialized_domains';
}

function classifySkillDomain(name) {
  if (name.includes('test') || name.includes('tdd') || name.includes('eval') || name.includes('bench')) {
    return 'Testing & Evals';
  }
  if (name.includes('database') || name.includes('sql') || name.includes('postgres') || name.includes('redis') || name.includes('mongo')) {
    return 'Data & Storage';
  }
  if (name.includes('api') || name.includes('backend') || name.includes('rest') || name.includes('auth') || name.includes('microservice')) {
    return 'Backend & APIs';
  }
  if (name.includes('front') || name.includes('react') || name.includes('css') || name.includes('ui') || name.includes('slide') || name.includes('web') || name.includes('design') || name.includes('a11y')) {
    return 'Frontend & Design';
  }
  if (name.includes('science') || name.includes('protein') || name.includes('bio') || name.includes('gene') || name.includes('chem') || name.includes('pdb') || name.includes('ncbi') || name.includes('alphafold')) {
    return 'Science & Bio';
  }
  if (name.includes('brand') || name.includes('market') || name.includes('article') || name.includes('content') || name.includes('investor') || name.includes('copy') || name.includes('post')) {
    return 'Strategy & Growth';
  }
  if (name.includes('agent') || name.includes('harness') || name.includes('memory') || name.includes('compact') || name.includes('loop') || name.includes('workflow') || name.includes('mcp') || name.includes('claude')) {
    return 'Agentic Infrastructure';
  }
  return 'Engineering Workflows';
}

class OasParser {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  parseAgents() {
    const agentsDir = path.join(this.workspaceRoot, 'agents');
    if (!fs.existsSync(agentsDir)) return [];

    const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    const allAgentNames = files.map(f => f.replace('.md', ''));

    return files.map(file => {
      const fullPath = path.join(agentsDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const { fm, body } = parseYamlFrontmatter(content);

      const id = file.replace('.md', '');
      const name = fm.name || id;
      const model = fm.model || fm['model-recommendation'] || 'sonnet';

      let tools = [];
      if (typeof fm.tools === 'string') {
        tools = fm.tools.split(',').map(t => t.trim()).filter(Boolean);
      } else if (Array.isArray(fm.tools)) {
        tools = fm.tools;
      }

      // Detect delegations to other agents
      const delegatesTo = allAgentNames.filter(other => other !== id && body.includes(other));

      return {
        id,
        name,
        filename: file,
        description: fm.description || '',
        model,
        tools,
        systemPrompt: body,
        cluster: classifyAgentCluster(id),
        delegatesTo
      };
    });
  }

  parseSkills() {
    const skillsDir = path.join(this.workspaceRoot, 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    const dirs = fs.readdirSync(skillsDir).filter(f => {
      const p = path.join(skillsDir, f);
      return fs.statSync(p).isDirectory();
    });

    return dirs.map(dir => {
      const skillPath = path.join(skillsDir, dir);
      const entries = fs.readdirSync(skillPath);
      const hasScripts = entries.includes('scripts');
      const hasReferences = entries.includes('references') || entries.includes('reference');
      const hasExamples = entries.includes('examples') || entries.includes('example');

      let description = '';
      let instructions = '';
      let triggers = [];

      const skillFile = path.join(skillPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        const content = fs.readFileSync(skillFile, 'utf8');
        const { fm, body } = parseYamlFrontmatter(content);
        description = fm.description || '';
        instructions = body;
        if (fm.triggers) {
          triggers = Array.isArray(fm.triggers) ? fm.triggers : [fm.triggers];
        }
      }

      return {
        id: dir,
        name: dir,
        directory: path.join('skills', dir),
        description,
        domain: classifySkillDomain(dir),
        hasScripts,
        hasReferences,
        hasExamples,
        triggers,
        instructions
      };
    });
  }

  parseCommands() {
    const commandsDir = path.join(this.workspaceRoot, 'commands');
    if (!fs.existsSync(commandsDir)) return [];

    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));

    return files.map(file => {
      const fullPath = path.join(commandsDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const { fm, body } = parseYamlFrontmatter(content);

      const id = file.replace('.md', '');
      return {
        id,
        name: fm.name || id,
        filename: file,
        description: fm.description || '',
        argumentHint: fm['argument-hint'] || fm.argument_hint || '',
        content: body
      };
    });
  }

  parseMcpServers() {
    const mcpPath = path.join(this.workspaceRoot, 'mcp-configs', 'mcp-servers.json');
    if (!fs.existsSync(mcpPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      return parsed.mcpServers || {};
    } catch {
      return {};
    }
  }

  parseRuleProfiles() {
    const rulesDir = path.join(this.workspaceRoot, 'rules');
    if (!fs.existsSync(rulesDir)) return [];
    return fs.readdirSync(rulesDir).filter(f => {
      return fs.statSync(path.join(rulesDir, f)).isDirectory();
    });
  }

  parseAll() {
    const agents = this.parseAgents();
    const skills = this.parseSkills();
    const commands = this.parseCommands();
    const mcpServers = this.parseMcpServers();
    const ruleProfiles = this.parseRuleProfiles();

    let hookCount = 0;
    const hooksDir = path.join(this.workspaceRoot, 'hooks');
    if (fs.existsSync(hooksDir)) {
      hookCount = fs.readdirSync(hooksDir).length;
    }

    return {
      agents,
      skills,
      commands,
      mcpServers,
      ruleProfiles,
      hookCount,
      summary: {
        totalAgents: agents.length,
        totalSkills: skills.length,
        totalCommands: commands.length,
        totalMcpServers: Object.keys(mcpServers).length,
        totalRuleProfiles: ruleProfiles.length
      }
    };
  }
}

module.exports = {
  OasParser,
  classifyAgentCluster,
  classifySkillDomain,
  parseYamlFrontmatter
};
