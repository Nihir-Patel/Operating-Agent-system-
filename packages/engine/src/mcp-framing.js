/**
 * @file packages/engine/src/mcp-framing.js
 * MCP stdio Content-Length framing with NDJSON fallback.
 */

function encodeMcpMessage(message) {
  const json = JSON.stringify(message);
  const length = Buffer.byteLength(json, 'utf8');
  return `Content-Length: ${length}\r\n\r\n${json}`;
}

function feedMcpBuffer(buffer, onMessage) {
  let buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'utf8');
  while (buf.length) {
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = buf.slice(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buf = buf.slice(headerEnd + 4);
        continue;
      }
      const size = Number(match[1]);
      const start = headerEnd + 4;
      if (buf.length < start + size) break;
      const json = buf.slice(start, start + size).toString('utf8');
      buf = buf.slice(start + size);
      onMessage(JSON.parse(json));
      continue;
    }
    const nl = buf.indexOf('\n');
    if (nl === -1) break;
    const line = buf.slice(0, nl).toString('utf8').trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    onMessage(JSON.parse(line));
  }
  return { rest: buf };
}

module.exports = {
  encodeMcpMessage,
  feedMcpBuffer
};
