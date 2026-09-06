/**
 * @file packages/parser/src/index.ts
 * OAS Enterprise Parser: High-speed AST and frontmatter parser for OAS entities
 */

export interface AgentDefinition {
  id: string;
  name: string;
  filename: string;
  description: string;
  model: 'sonnet' | 'opus' | 'haiku' | string;
  tools: string[];
  systemPrompt: string;
  cluster: 'architecture_and_planning' | 'quality_and_review' | 'build_resolvers' | 'operations_and_meta' | 'specialized_domains';
  delegatesTo: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  directory: string;
  description: string;
  domain: string;
  hasScripts: boolean;
  hasReferences: boolean;
  hasExamples: boolean;
  triggers: string[];
  instructions: string;
}

export interface CommandDefinition {
  id: string;
  name: string;
  filename: string;
  description: string;
  argumentHint: string;
  content: string;
}

export interface McpServerDefinition {
  name: string;
  command: string;
  args: string[];
  description?: string;
  env?: Record<string, string>;
}

export interface ParseResult {
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  commands: CommandDefinition[];
  mcpServers: Record<string, McpServerDefinition>;
  ruleProfiles: string[];
  hookCount: number;
}
