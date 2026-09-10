/**
 * @file packages/engine/src/otlp-consent.js
 * Consent-gated OTLP JSON payload. No export without explicit consent.
 */

function buildConsentGatedOtlp(input = {}) {
  if (!input.consent) return null;
  const name = String(input.name || 'oas.span').slice(0, 80);
  const traceId = String(input.traceId || '0'.repeat(32)).replace(/[^a-fA-F0-9]/g, '').padEnd(32, '0').slice(0, 32);
  const spanId = String(input.spanId || '0'.repeat(16)).replace(/[^a-fA-F0-9]/g, '').padEnd(16, '0').slice(0, 16);
  return {
    consent: true,
    schemaVersion: 'oas.otlp.v1',
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'oas-studio' } }] },
      scopeSpans: [{
        spans: [{
          name,
          traceId,
          spanId,
          kind: 1
        }]
      }]
    }]
  };
}

module.exports = { buildConsentGatedOtlp };
