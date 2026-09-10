/**
 * @file packages/engine/src/agent-tools.js
 * Native tool schemas plus markdown tool-call fallback parser.
 */

const OAS_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 file inside the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a UTF-8 file inside the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run an allowlisted sandbox command in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search workspace files for a query string.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List a workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        }
      }
    }
  }
];

function toAnthropicTools(tools = OAS_AGENT_TOOLS) {
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters
  }));
}

function extractMarkdownToolCall(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/```(?:tool_call|json)?\s*\n?(\{[\s\S]*?"tool"\s*:\s*".*?"[\s\S]*?\})\s*\n?```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || !parsed.tool) return null;
    return { tool: parsed.tool, args: parsed.args || {} };
  } catch {
    return null;
  }
}

function normalizeNativeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return [];
  return toolCalls.map(call => {
    const fn = call.function || call;
    const name = fn.name || call.name || call.tool;
    let args = fn.arguments || fn.input || call.args || call.input || {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = { raw: args };
      }
    }
    return { tool: name, args: args && typeof args === 'object' ? args : {} };
  }).filter(call => call.tool);
}

module.exports = {
  OAS_AGENT_TOOLS,
  toAnthropicTools,
  extractMarkdownToolCall,
  normalizeNativeToolCalls
};
