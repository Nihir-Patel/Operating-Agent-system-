/**
 * @file packages/db/src/schema.js
 * OAS Enterprise Drizzle ORM Schema (PostgreSQL + pgvector / SQLite compatible)
 */

const schemaSql = `
-- Workspaces & Multi-tenant Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(128) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspaces (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  root_path TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Parsed Agent Definitions
CREATE TABLE IF NOT EXISTS agent_definitions (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  description TEXT,
  model VARCHAR(64) NOT NULL DEFAULT 'sonnet',
  tools JSONB DEFAULT '[]'::jsonb,
  system_prompt TEXT,
  cluster VARCHAR(64) NOT NULL,
  delegates_to JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Parsed Skill Definitions
CREATE TABLE IF NOT EXISTS skill_definitions (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  directory TEXT NOT NULL,
  description TEXT,
  domain VARCHAR(128) NOT NULL,
  has_scripts BOOLEAN DEFAULT FALSE,
  has_references BOOLEAN DEFAULT FALSE,
  has_examples BOOLEAN DEFAULT FALSE,
  triggers JSONB DEFAULT '[]'::jsonb,
  instructions TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Agent Execution Sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) REFERENCES workspaces(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active', 'paused', 'completed', 'aborted', 'failed'
  lead_agent_id VARCHAR(64) REFERENCES agent_definitions(id),
  total_tokens INTEGER DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(10, 6) DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP WITH TIME ZONE
);

-- Granular Trajectory Steps
CREATE TABLE IF NOT EXISTS agent_steps (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  agent_id VARCHAR(64) REFERENCES agent_definitions(id),
  step_type VARCHAR(32) NOT NULL, -- 'thought', 'tool_call', 'tool_result', 'diff', 'intervention'
  content TEXT,
  tool_name VARCHAR(128),
  tool_args JSONB,
  tool_result JSONB,
  diff_content TEXT,
  duration_ms INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Durable Memory Vault with Vector Embeddings
CREATE TABLE IF NOT EXISTS memory_vault (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) REFERENCES workspaces(id) ON DELETE CASCADE,
  scope VARCHAR(32) NOT NULL DEFAULT 'project', -- 'user', 'team', 'project'
  kind VARCHAR(64) NOT NULL DEFAULT 'convention', -- 'rule', 'pattern', 'decision', 'architecture'
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  embedding_vector vector(1536), -- pgvector extension
  hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Artifacts (Plans, Diffs, Canvas Annotations)
CREATE TABLE IF NOT EXISTS artifacts (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) REFERENCES agent_sessions(id) ON DELETE CASCADE,
  artifact_type VARCHAR(64) NOT NULL, -- 'plan', 'diff', 'annotation', 'test_report'
  title VARCHAR(255) NOT NULL,
  file_path TEXT,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
`;

module.exports = {
  schemaSql
};
