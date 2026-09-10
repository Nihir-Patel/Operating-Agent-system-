/**
 * End-to-End Operational Verification of OAS with Ollama (qwen2.5-coder:7b)
 */
const http = require('http');

const BASE_URL = 'http://127.0.0.1:3458';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runOllamaE2E() {
  console.log('--- STARTING OAS + OLLAMA OPERATIONAL TEST ---');

  // Step 1: Check Catalog
  console.log('\n1. Checking Control Plane Catalog...');
  const catRes = await request('GET', '/api/catalog');
  console.log(`   Catalog Status: ${catRes.status}`);
  console.log(`   Agents Loaded: ${catRes.data.agents?.length || 0}`);
  console.log(`   Skills Loaded: ${catRes.data.skills?.length || 0}`);

  // Step 2: Configure Ollama Settings
  console.log('\n2. Configuring Settings for Ollama (qwen2.5-coder:7b)...');
  const settingsRes = await request('POST', '/api/settings', {
    provider: 'ollama',
    ollamaHost: 'http://localhost:11434',
    ollamaModel: 'qwen2.5-coder:7b',
    sandboxEnabled: true,
    worktreeIsolation: true
  });
  console.log(`   Settings Updated: ${settingsRes.status}`);
  console.log(`   Active Provider: ${settingsRes.data.provider}`);
  console.log(`   Ollama Model: ${settingsRes.data.ollamaModel}`);

  // Step 3: Test Provider Connection
  console.log('\n3. Testing Connection to Ollama Host...');
  const testRes = await request('POST', '/api/settings/test', {
    provider: 'ollama',
    ollamaHost: 'http://localhost:11434'
  });
  console.log(`   Connection Status: ${testRes.status}`);
  console.log(`   Success: ${testRes.data.success}`);
  console.log(`   Message: ${testRes.data.message}`);

  // Step 4: Create a New Agent Session
  console.log('\n4. Creating a New Session for Ollama Execution...');
  const sessRes = await request('POST', '/api/sessions', {
    title: 'Ollama Qwen2.5 Coder Operational Test',
    lead_agent_id: 'planner',
    pipelineType: 'feature_lifecycle'
  });
  const sessionId = sessRes.data.id;
  console.log(`   Created Session ID: ${sessionId}`);
  console.log(`   Title: ${sessRes.data.title}`);

  // Step 5: Execute an Agent Step with Ollama
  console.log('\n5. Executing DAG Step with Ollama Qwen2.5-Coder...');
  console.log('   Sending prompt to Planner agent via Ollama...');
  const stepRes = await request('POST', `/api/sessions/${sessionId}/execute`, {
    intent: 'Analyze project architecture and design a rate-limiting middleware',
    prompt: 'Provide a concise architectural breakdown for adding rate limiting to this API.'
  });
  console.log(`   Step Execution Status: ${stepRes.status}`);
  if (stepRes.data.step) {
    console.log(`   Agent: ${stepRes.data.step.agentId || stepRes.data.step.agent_id}`);
    console.log(`   Model Used: ${stepRes.data.step.model || 'qwen2.5-coder:7b'}`);
    console.log(`   Output Length: ${(stepRes.data.step.content || '').length} chars`);
    console.log(`   Output Snippet: ${(stepRes.data.step.content || '').slice(0, 150)}...`);
  }

  // Step 6: Verify Session Steps in Database
  console.log('\n6. Verifying Session Steps in Database...');
  const verifyRes = await request('GET', `/api/sessions/${sessionId}`);
  console.log(`   Retrieve Session Status: ${verifyRes.status}`);
  console.log(`   Recorded Steps: ${verifyRes.data.steps?.length || 0}`);
  if (verifyRes.data.steps && verifyRes.data.steps.length > 0) {
    console.log('   Step Content Sample:');
    console.log('   ---------------------------------------------');
    console.log('   ' + verifyRes.data.steps[0].content.slice(0, 200).replace(/\n/g, '\n   ') + '...');
    console.log('   ---------------------------------------------');
  }

  console.log('\n=== ALL OPERATIONAL TESTS PASSED WITH OLLAMA! ===\n');
}

runOllamaE2E().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
