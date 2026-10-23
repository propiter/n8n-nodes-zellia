'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const { ZelliaTrigger } = require('../dist/nodes/ZelliaTrigger/ZelliaTrigger.node.js');
const { verifySignature } = require('../dist/nodes/ZelliaTrigger/signature.js');
const { simplifyEvent } = require('../dist/nodes/ZelliaTrigger/simplify.js');
const { createContext } = require('./helpers');

const SECRET = 'whsec';

function sign(body, timestamp, secret = SECRET) {
	return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

const MESSAGE = {
	event: 'message_created',
	id: 501,
	content: 'Hola, quiero cotizar',
	message_type: 'incoming',
	content_type: 'text',
	private: false,
	created_at: '2026-10-22T10:00:00Z',
	sender: { id: 31, name: 'Ana', type: 'contact' },
	account: { id: 14, name: 'Llantas' },
	conversation: {
		id: 47136,
		inbox_id: 23,
		status: 'open',
		labels: ['vip'],
		custom_attributes: {},
		meta: { sender: { id: 31, name: 'Ana', phone_number: '+573001234567' }, assignee: null, team: null },
	},
};

function webhookContext({ params = {}, body, headers = {}, query = {}, secret } = {}) {
	const context = createContext({ params: { source: 'webhook', simplify: true, ...params } });
	const raw = Buffer.from(JSON.stringify(body));
	const response = {};
	if (secret) context.staticData.webhookSecret = secret;
	Object.assign(context, {
		getBodyData: () => body,
		getQueryData: () => query,
		getRequestObject: () => ({ headers, rawBody: raw }),
		getResponseObject: () => ({
			status(code) {
				response.status = code;
				return this;
			},
			json(data) {
				response.body = data;
			},
		}),
	});
	return { context, raw, response };
}

async function receive(options) {
	const { context, response, raw } = webhookContext({ secret: SECRET, ...options });
	const source = (options.params && options.params.source) || 'webhook';
	if (source === 'webhook' && !options.headers) {
		// Sign like Zellia does, unless the test brings its own headers
		const now = Math.floor(Date.now() / 1000);
		context.getRequestObject = () => ({
			headers: { 'x-chatwoot-signature': sign(raw.toString(), now), 'x-chatwoot-timestamp': String(now) },
			rawBody: raw,
		});
	}
	const result = await new ZelliaTrigger().webhook.call(context);
	const items = result.workflowData ? result.workflowData.flat().map((item) => item.json) : null;
	return { items, response, result };
}

describe('signature', () => {
	const body = '{"event":"message_created"}';
	const now = 1_800_000_000;

	test('accepts a fresh, valid signature', () => {
		assert.equal(verifySignature(SECRET, String(now), sign(body, now), Buffer.from(body), now + 10), true);
	});

	test('rejects a wrong secret, a changed body and an old timestamp', () => {
		assert.equal(verifySignature(SECRET, String(now), sign(body, now, 'other'), Buffer.from(body), now), false);
		assert.equal(verifySignature(SECRET, String(now), sign(body, now), Buffer.from(`${body} `), now), false);
		assert.equal(verifySignature(SECRET, String(now), sign(body, now), Buffer.from(body), now + 301), false);
		assert.equal(verifySignature(SECRET, '', sign(body, now), Buffer.from(body), now), false);
	});
});

describe('webhook filtering', () => {
	test('an incoming message comes out simplified', async () => {
		const { items } = await receive({ body: MESSAGE });
		assert.equal(items.length, 1);
		assert.equal(items[0].text, 'Hola, quiero cotizar');
		assert.equal(items[0].conversation_id, 47136);
		assert.equal(items[0].contact_phone, '+573001234567');
		assert.deepEqual(items[0].labels, ['vip']);
	});

	test('outgoing messages and private notes are skipped by default', async () => {
		for (const body of [{ ...MESSAGE, message_type: 'outgoing' }, { ...MESSAGE, private: true }]) {
			assert.deepEqual((await receive({ body })).items, []);
		}
	});

	test('bot messages are skipped even when outgoing messages are allowed', async () => {
		const params = { messageFilters: { messageTypes: ['incoming', 'outgoing'] } };
		const fromBot = { ...MESSAGE, message_type: 'outgoing', sender: { id: 2, type: 'agent_bot' } };
		const fromAgent = { ...MESSAGE, message_type: 'outgoing', sender: { id: 6, type: 'user' } };
		assert.deepEqual((await receive({ body: fromBot, params })).items, []);
		assert.equal((await receive({ body: fromAgent, params })).items.length, 1);
	});

	test('required labels must match at least one', async () => {
		assert.deepEqual((await receive({ body: MESSAGE, params: { requiredLabels: 'ventas, otro' } })).items, []);
		assert.equal((await receive({ body: MESSAGE, params: { requiredLabels: 'ventas, vip' } })).items.length, 1);
	});

	test('a bad signature is rejected when a secret is stored', async () => {
		const now = Math.floor(Date.now() / 1000);
		const { response, result } = await receive({
			body: MESSAGE,
			secret: SECRET,
			headers: { 'x-chatwoot-signature': 'sha256=bad', 'x-chatwoot-timestamp': String(now) },
		});
		assert.equal(response.status, 401);
		assert.equal(result.noWebhookResponse, true);
	});

	test('a webhook without a stored secret is rejected', async () => {
		const { response } = await receive({ body: MESSAGE, secret: '', headers: {} });
		assert.equal(response.status, 401);
	});

	test('the inbox filter drops other channels and keeps contact events', async () => {
		const params = { inboxId: '23' };
		assert.equal((await receive({ body: MESSAGE, params })).items.length, 1);
		const otherInbox = { ...MESSAGE, conversation: { ...MESSAGE.conversation, inbox_id: 99 } };
		assert.deepEqual((await receive({ body: otherInbox, params })).items, []);
		const contactEvent = { event: 'contact_created', id: 31, name: 'Ana' };
		assert.equal((await receive({ body: contactEvent, params })).items.length, 1);
	});

	test('Captain replies count as bot messages', async () => {
		const params = { messageFilters: { messageTypes: ['outgoing'] } };
		const fromCaptain = { ...MESSAGE, message_type: 'outgoing', sender: { id: 1, type: 'captain_assistant' } };
		assert.deepEqual((await receive({ body: fromCaptain, params })).items, []);
	});

	test('required labels ignore case', async () => {
		assert.equal((await receive({ body: MESSAGE, params: { requiredLabels: 'VIP' } })).items.length, 1);
	});

	test('a good signature passes', async () => {
		const now = Math.floor(Date.now() / 1000);
		const { context, raw } = webhookContext({ body: MESSAGE, secret: SECRET });
		const signature = sign(raw.toString(), now);
		context.getRequestObject = () => ({
			headers: { 'x-chatwoot-signature': signature, 'x-chatwoot-timestamp': String(now) },
			rawBody: raw,
		});
		const result = await new ZelliaTrigger().webhook.call(context);
		assert.equal(result.workflowData[0].length, 1);
	});

	test('automation source checks the token in the URL', async () => {
		const body = { event: 'automation_event.pipeline_stage_changed', deal: { id: 1 } };
		const params = { source: 'automation', automationToken: 's3cret' };
		assert.equal((await receive({ body, params, query: { token: 'nope' } })).response.status, 401);
		assert.equal((await receive({ body, params, query: { token: 's3cret' } })).items.length, 1);
	});

	test('automation source rejects everything when no token is set', async () => {
		const body = { event: 'automation_event.pipeline_stage_changed', deal: { id: 1 } };
		const params = { source: 'automation', automationToken: '' };
		assert.equal((await receive({ body, params, query: {} })).response.status, 401);
	});
});

describe('simplify', () => {
	test('deal stage change from an automation rule', () => {
		const result = simplifyEvent({
			event: 'automation_event.pipeline_stage_changed',
			automation_rule: { id: 35, name: 'Ganado' },
			performed_by: { type: 'AgentBot', id: 4 },
			from_stage: { id: 8, name: 'Cotizado', stage_type: 'open' },
			conversation_id: 47136,
			deal: {
				id: 6303,
				pipeline: { id: 2, name: 'Ventas' },
				stage: { id: 9, name: 'Won', stage_type: 'won' },
				status: 'won',
				value: '850000.0',
				currency: 'COP',
				contact: { id: 31, name: 'Ana', phone_number: '+573001234567' },
				assignee: null,
			},
		});
		assert.equal(result.deal_id, 6303);
		assert.equal(result.value, 850000);
		assert.equal(result.stage_type, 'won');
		assert.equal(result.from_stage_name, 'Cotizado');
		assert.equal(result.conversation_id, 47136);
		assert.equal(result.performed_by_type, 'AgentBot');
		assert.equal(result.assignee_id, null);
	});

	test('unknown events pass through unchanged', () => {
		const body = { event: 'inbox_created', id: 1 };
		assert.deepEqual(simplifyEvent(body), body);
	});
});

describe('webhook lifecycle', () => {
	const params = { source: 'webhook', events: ['message_created'], inboxId: '' };

	test('create registers the webhook and keeps its secret', async () => {
		const context = createContext({
			params,
			routes: { 'POST /webhooks': { payload: { webhook: { id: 12, secret: 'abc' } } } },
		});
		assert.equal(await new ZelliaTrigger().webhookMethods.default.create.call(context), true);
		assert.deepEqual(context.calls[0].body.webhook.subscriptions, ['message_created']);
		assert.deepEqual(context.staticData, { webhookId: 12, webhookSecret: 'abc' });
	});

	test('checkExists re-registers when the events changed', async () => {
		const context = createContext({
			params,
			routes: {
				'GET /webhooks': {
					payload: { webhooks: [{ id: 12, url: 'https://n8n.test/webhook/abc/webhook', subscriptions: ['message_updated'] }] },
				},
				'DELETE /webhooks/12': '',
			},
		});
		assert.equal(await new ZelliaTrigger().webhookMethods.default.checkExists.call(context), false);
		assert.equal(context.calls.at(-1).method, 'DELETE');
	});

	test('checkExists keeps a matching webhook', async () => {
		const context = createContext({
			params,
			routes: {
				'GET /webhooks': {
					payload: { webhooks: [{ id: 12, url: 'https://n8n.test/webhook/abc/webhook', subscriptions: ['message_created'], secret: 'abc' }] },
				},
			},
		});
		assert.equal(await new ZelliaTrigger().webhookMethods.default.checkExists.call(context), true);
		assert.equal(context.staticData.webhookSecret, 'abc');
	});

	test('checkExists removes the webhook it registered for an old URL', async () => {
		const context = createContext({
			params,
			routes: {
				'GET /webhooks': {
					payload: { webhooks: [{ id: 12, url: 'https://n8n.test/webhook/old-path', subscriptions: ['message_created'] }] },
				},
				'DELETE /webhooks/12': '',
			},
		});
		context.staticData.webhookId = 12;
		context.staticData.webhookSecret = 'abc';
		assert.equal(await new ZelliaTrigger().webhookMethods.default.checkExists.call(context), false);
		assert.deepEqual(context.calls.map((call) => `${call.method} ${call.path}`), ['GET /webhooks', 'DELETE /webhooks/12']);
		assert.deepEqual(context.staticData, {});
	});

	test('automation source registers nothing', async () => {
		const context = createContext({ params: { source: 'automation' } });
		assert.equal(await new ZelliaTrigger().webhookMethods.default.checkExists.call(context), true);
		assert.equal(context.calls.length, 0);
	});

	test('delete removes the stored webhook', async () => {
		const context = createContext({
			params,
			routes: { 'GET /webhooks': { payload: { webhooks: [{ id: 12 }] } }, 'DELETE /webhooks/12': '' },
		});
		context.staticData.webhookId = 12;
		context.staticData.webhookSecret = 'abc';
		assert.equal(await new ZelliaTrigger().webhookMethods.default.delete.call(context), true);
		assert.deepEqual(context.staticData, {});
	});
});

describe('webhook definition', () => {
	test('the path comes from the node and the answer is empty', () => {
		const [webhook] = new ZelliaTrigger().description.webhooks;
		assert.equal(webhook.path, '={{$parameter["path"]}}');
		assert.equal(webhook.isFullPath, true);
		assert.equal(webhook.responseData, 'noData');
		assert.ok(new ZelliaTrigger().description.properties.some((p) => p.name === 'path'));
	});
});
