/**
 * OAS Plugins for OpenCode
 *
 * This module exports all OAS plugins for OpenCode integration.
 * Plugins provide hook-based automation that mirrors Claude Code's hook system
 * while taking advantage of OpenCode's more sophisticated 20+ event types.
 */

export { OASHooksPlugin, default } from "./oas-hooks.js"

// Re-export for named imports
export * from "./oas-hooks.js"
