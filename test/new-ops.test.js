'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { Zellia } = require('../dist/nodes/Zellia/Zellia.node.js');
const { ZelliaToolTrigger, captainContext } = require('../dist/nodes/ZelliaToolTrigger/ZelliaToolTrigger.node.js');
const { createContext, HttpError } = require('./helpers');

async function execute(params, routes) {
	const context = createContext({ params, routes });
	const output = await new Zellia().execute.call(context);
	return { items: output[0].map((item) => item.json), calls: context.calls };
}

describe('conversation hand off', () => {
	const base = {
		resource: 'conversation',
		operation: 'handOff',
		conversationId: 5,
		handOffMessage: 'Te paso con un asesor',
		handOffNote: 'Resumen',
		handOffLabels: ['Calificado'],
		handOffLabelMode: 'add',
		handOffAgentId: '',
		handOffTeamId: '3',
		handOffStatus: 'open',
		handOffContinueOnError: false,
	};
	const routes = {
		'POST /conversations/5/messages': (call) => ({ id: call.body.private ? 2 : 1, private: !!call.body.private }),
		'GET /conversations/5/labels': { payload: ['vip'] },
		'POST /conversations/5/labels': (call) => ({ payload: call.body.labels }),
		'POST /conversations/5/assignments': (call) => ({ id: call.body.team_id, name: 'Ventas' }),
		'POST /conversations/5/toggle_status': (call) => ({ payload: { current_status: call.body.status } }),
	};

	test('runs message, note, labels, team and status in that order', async () => {
		const { items, calls } = await execute(base, routes);
		assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
			'POST /conversations/5/messages',
			'POST /conversations/5/messages',
			'GET /conversations/5/labels',
			'POST /conversations/5/labels',
			'POST /conversations/5/assignments',
			'POST /conversations/5/toggle_status',
		]);
		assert.equal(calls[0].body.private, undefined);
		assert.equal(calls[1].body.private, true);
		assert.deepEqual(calls[3].body, { labels: ['vip', 'calificado'] });
		assert.deepEqual(items[0].labels, ['vip', 'calificado']);
		assert.equal(items[0].status, 'open');
		assert.equal(items[0].errors, undefined);
	});

	test('skips the empty steps and keeps the status when asked', async () => {
		const { calls } = await execute(
			{ ...base, handOffMessage: '', handOffNote: ' ', handOffLabels: [], handOffTeamId: '', handOffStatus: 'keep' },
			routes,
		);
		assert.equal(calls.length, 0);
	});

	test('replace mode sets the exact list without reading first', async () => {
		const { calls } = await execute(
			{ ...base, handOffMessage: '', handOffNote: '', handOffTeamId: '', handOffStatus: 'keep', handOffLabelMode: 'replace', handOffLabels: ['seguimiento'] },
			routes,
		);
		assert.deepEqual(calls.map((call) => call.method), ['POST']);
		assert.deepEqual(calls[0].body, { labels: ['seguimiento'] });
	});

	test('a failed step stops the node unless continue is on', async () => {
		const failing = { ...routes, 'POST /conversations/5/labels': () => { throw new HttpError(422, { error: 'bad label' }); } };
		await assert.rejects(execute(base, failing), /bad label/);
		const { items, calls } = await execute({ ...base, handOffContinueOnError: true }, failing);
		assert.deepEqual(items[0].errors, { labels: 'bad label' });
		assert.equal(items[0].status, 'open');
		assert.equal(calls.at(-1).path, '/conversations/5/toggle_status');
	});
});

describe('conversation status', () => {
	const conversation = (extra) => ({
		'GET /conversations/5': {
			id: 5, status: 'open', priority: 'high', labels: ['vip'], custom_attributes: { pago: 'ok' },
			meta: { assignee: { id: 9, name: 'Ana' }, assignee_type: 'User', team: { id: 3, name: 'Ventas' } }, ...extra,
		},
	});

	test('get status says who handles the conversation', async () => {
		const { items } = await execute({ resource: 'conversation', operation: 'getStatus', conversationId: 5 }, conversation());
		assert.deepEqual(
			{ status: items[0].status, handled_by: items[0].handled_by, assignee: items[0].assignee_name, team: items[0].team_name, priority: items[0].priority },
			{ status: 'open', handled_by: 'agent', assignee: 'Ana', team: 'Ventas', priority: 'high' },
		);
		const pending = await execute({ resource: 'conversation', operation: 'getStatus', conversationId: 5 }, conversation({ status: 'pending', meta: {} }));
		assert.equal(pending.items[0].handled_by, 'bot');
		const nobody = await execute({ resource: 'conversation', operation: 'getStatus', conversationId: 5 }, conversation({ meta: {}, waiting_since: 0 }));
		assert.equal(nobody.items[0].handled_by, 'nobody');
		assert.equal(nobody.items[0].waiting_since, null);
		const bot = await execute({ resource: 'conversation', operation: 'getStatus', conversationId: 5 }, conversation({ meta: { assignee: { id: 12, name: 'LLANTIN' }, assignee_type: 'AgentBot' } }));
		assert.equal(bot.items[0].handled_by, 'bot');
		assert.equal(bot.items[0].assignee_type, 'bot');
		const pendingHuman = await execute({ resource: 'conversation', operation: 'getStatus', conversationId: 5 }, conversation({ status: 'pending' }));
		assert.equal(pendingHuman.items[0].handled_by, 'agent');
	});

	test('get custom attributes returns only the attributes', async () => {
		const { items } = await execute({ resource: 'conversation', operation: 'getAttributes', conversationId: 5 }, conversation());
		assert.deepEqual(items[0], { conversation_id: 5, custom_attributes: { pago: 'ok' } });
	});
});

describe('close a deal from a conversation', () => {
	const STAGES = { payload: [{ id: 9, stage_type: 'won' }, { id: 10, stage_type: 'lost' }] };
	const params = (operation, extra = {}) => ({
		resource: 'deal', operation, pipelineId: '2', dealLookup: 'conversation', conversationId: 40, value: 850000, currency: '', ...extra,
	});
	const routes = (deals, extra = {}, linked = deals) => ({
		'GET /conversations/40': { id: 40, meta: { sender: { id: 5 } } },
		'GET /contacts/5/pipeline_items': (call) => ({ payload: call.qs && call.qs.conversation_id ? linked : deals }),
		...extra,
	});

	test('wins the open deal of the pipeline', async () => {
		const { items, calls } = await execute(params('markWon'), routes(
			[{ id: 1, pipeline_id: 3, status: 'open' }, { id: 7, pipeline_id: 2, status: 'open', value: '0.0' }],
			{
				'GET /pipelines/2/items/7': { payload: { id: 7, status: 'open', value: '0.0', currency: 'COP' } },
				'PATCH /pipelines/2/items/7': { payload: {} },
				'GET /pipelines/2/stages': STAGES,
				'POST /pipelines/2/items/7/move': { payload: { id: 7, status: 'won' } },
			},
		));
		assert.equal(items[0].result, 'won');
		assert.deepEqual(calls.at(-1).body, { pipeline_stage_id: 9 });
	});

	test('reports already won when this conversation already closed it', async () => {
		const { items, calls } = await execute(params('markWon'), routes([
			{ id: 7, pipeline_id: 2, status: 'won', value: '900000.0', active_conversation: { id: 40 } },
		]));
		assert.equal(items[0].result, 'already_won');
		assert.equal(items[0].id, 7);
		assert.deepEqual(calls[2].qs, { conversation_id: 40 });
	});

	test('reports no deal instead of failing', async () => {
		const { items } = await execute(params('markLost'), routes([{ id: 7, pipeline_id: 2, status: 'won' }], {}, []));
		assert.deepEqual(items[0], { result: 'no_deal', conversation_id: 40, contact_id: 5 });
	});

	test('a deal closed while only linked to this conversation counts as already done', async () => {
		const { items } = await execute(params('markWon'), routes([], {}, [{ id: 8, pipeline_id: 2, status: 'won' }]));
		assert.equal(items[0].result, 'already_won');
		assert.equal(items[0].id, 8);
	});

	test('the deal ID mode still works and now says the result', async () => {
		const { items } = await execute(
			{ resource: 'deal', operation: 'markLost', pipelineId: '2', dealLookup: 'dealId', dealId: 7 },
			{ 'GET /pipelines/2/items/7': { payload: { id: 7, status: 'lost' } } },
		);
		assert.equal(items[0].result, 'already_lost');
	});
});

describe('Captain tool trigger', () => {
	const HEADERS = {
		'x-chatwoot-tool-slug': 'custom_enviar_imagen',
		'x-chatwoot-account-id': '14',
		'x-chatwoot-assistant-id': '4',
		'x-chatwoot-conversation-display-id': '48855',
		'x-chatwoot-conversation-id': '37115',
		'x-chatwoot-contact-id': '41159',
		'x-chatwoot-contact-phone': '+573006099126',
		'x-chatwoot-contact-inbox-verified': 'false',
		'x-chatwoot-channel-type': 'Channel::Whatsapp',
	};

	function call(params, { headers = HEADERS, body = {}, query = {} } = {}) {
		const context = createContext({ params: { httpMethod: 'POST', authentication: 'none', accountId: 0, ...params } });
		const response = {};
		Object.assign(context, {
			getRequestObject: () => ({ headers }),
			getBodyData: () => body,
			getQueryData: () => query,
			getResponseObject: () => ({ status(code) { response.status = code; return this; }, json(data) { response.body = data; } }),
		});
		return new ZelliaToolTrigger().webhook.call(context).then((result) => ({
			response,
			items: result.workflowData ? result.workflowData.flat().map((item) => item.json) : null,
		}));
	}

	test('the context comes from the headers and the params from the body', async () => {
		const { items } = await call({}, { body: { image_url: 'https://x.test/a.png', nombre: 'Llanta' } });
		assert.deepEqual(items[0], {
			...captainContext(HEADERS),
			params: { image_url: 'https://x.test/a.png', nombre: 'Llanta' },
		});
		assert.equal(items[0].conversation_id, 48855);
		assert.equal(items[0].contact_phone, '+573006099126');
		assert.equal(items[0].tool, 'custom_enviar_imagen');
		assert.equal(items[0].source, 'chat');
	});

	test('GET tools read the params from the URL', async () => {
		const { items } = await call({ httpMethod: 'GET' }, { query: { medida: '215/65R16' } });
		assert.deepEqual(items[0].params, { medida: '215/65R16' });
	});

	test('bearer, header and basic authentication', async () => {
		assert.equal((await call({ authentication: 'bearer', authToken: 's3' })).response.status, 401);
		assert.equal((await call({ authentication: 'bearer', authToken: 's3' }, { headers: { ...HEADERS, authorization: 'Bearer s3' } })).items.length, 1);
		assert.equal((await call({ authentication: 'header', authHeaderName: 'X-Api-Key', authHeaderValue: 'k' }, { headers: { ...HEADERS, 'x-api-key': 'k' } })).items.length, 1);
		const basic = 'Basic ' + Buffer.from('u:p').toString('base64');
		assert.equal((await call({ authentication: 'basic', authUser: 'u', authPassword: 'p' }, { headers: { ...HEADERS, authorization: basic } })).items.length, 1);
		assert.equal((await call({ authentication: 'basic', authUser: 'u', authPassword: 'x' }, { headers: { ...HEADERS, authorization: basic } })).response.status, 401);
	});

	test('an empty token never opens the tool', async () => {
		assert.equal((await call({ authentication: 'bearer', authToken: '' }, { headers: { ...HEADERS, authorization: 'Bearer ' } })).response.status, 401);
	});

	test('calls from another account are refused', async () => {
		assert.equal((await call({ accountId: 23 })).response.status, 403);
		assert.equal((await call({ accountId: 14 })).items.length, 1);
	});
});
