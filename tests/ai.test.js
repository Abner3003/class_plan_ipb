import test from 'node:test';
import assert from 'node:assert/strict';
import { generateField } from '../src/ai.js';

const field = { field: 'Versículo', text: '', context: [], instruction: 'Complete o campo.' };
const completed = { status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: ' Texto completo (ARA) ' }] }] };
function setup(responses) {
  const calls = [];
  const options = {
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const next = responses.shift();
      assert.ok(next, 'Unexpected extra attempt');
      if (next instanceof Error) throw next;
      return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status || 200 });
    },
  };
  return { calls, run: (input = field, env = {}) => generateField({ OPENAI_API_KEY: 'test', ...env }, input, options) };
}

test('returns complete text and applies ARA rule to both actions', async () => {
  for (const action of ['complete', 'spellcheck']) {
    const mock = setup([{ body: completed }]);
    assert.deepEqual(await mock.run({ ...field, action }), { text: 'Texto completo (ARA)' });
    assert.match(mock.calls[0].input[0].content, /exclusivamente a versão ARA/);
    assert.match(mock.calls[0].input[0].content, /correção ortográfica/);
    assert.equal(mock.calls[0].reasoning.effort, 'minimal');
  }
});

test('retries token exhaustion with larger budget, discarding partial text', async () => {
  const mock = setup([{ body: { ...completed, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'PARCIAL' } }, { body: completed }]);
  assert.deepEqual(await mock.run(), { text: 'Texto completo (ARA)' });
  assert.ok(mock.calls[1].max_output_tokens > mock.calls[0].max_output_tokens);
});

test('recovers from transient HTTP, empty output, malformed JSON and transport failures', async () => {
  for (const failure of [
    { status: 502, body: '<html>Bad gateway</html>' },
    { status: 429, body: { error: { code: 'rate_limit_exceeded' } } },
    { body: { status: 'completed', output: [] } },
    { body: 'not json' },
    new DOMException('timeout', 'TimeoutError'),
  ]) {
    const mock = setup([failure, { body: completed }]);
    assert.deepEqual(await mock.run(), { text: 'Texto completo (ARA)' });
    assert.equal(mock.calls.length, 2);
  }
});

test('stops after two failed attempts without returning partial text', async () => {
  const incomplete = { body: { status: 'incomplete', output_text: 'PARCIAL', incomplete_details: { reason: 'max_output_tokens' } } };
  const mock = setup([incomplete, incomplete]);
  const result = await mock.run();
  assert.equal(result.status, 503);
  assert.equal(result.text, undefined);
  assert.equal(mock.calls.length, 2);
});

test('does not retry permanent provider failures or refusals', async () => {
  for (const failure of [
    { status: 401, body: { error: { code: 'invalid_api_key' } } },
    { status: 400, body: { error: { code: 'invalid_request' } } },
    { status: 429, body: { error: { code: 'insufficient_quota' } } },
    { body: { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] } },
    { body: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } } },
  ]) {
    const mock = setup([failure]);
    assert.ok((await mock.run()).error);
    assert.equal(mock.calls.length, 1);
  }
});

test('preserves configured model without adding unsupported reasoning setting', async () => {
  const mock = setup([{ body: completed }]);
  await mock.run(field, { OPENAI_MODEL: 'gpt-4.1-mini' });
  assert.equal(mock.calls[0].model, 'gpt-4.1-mini');
  assert.equal(mock.calls[0].reasoning, undefined);
});
