/**
 * Compatibility shim: the plugin root resolver lives in resolve-ecc-root.js.
 * Hooks, INLINE_RESOLVE, and tests still load this path.
 */
module.exports = require('./resolve-ecc-root');
