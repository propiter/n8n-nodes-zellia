'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { Zellia } = require('../dist/nodes/Zellia/Zellia.node.js');
const { buildMessageBody } = require('../dist/nodes/Zellia/actions/message.js');
const {
	normalizePhone,
	parseLabels,
	keyValuesToObject,
	buildMultipart,
	describeZelliaError,
} = require('../dist/nodes/Zellia/GenericFunctions.js');
const { createContext, HttpError } = require('./helpers');

async function execute(params, routes, extra = {}) {
	const context = createContext({ params, routes, ...extra });
	const output = await new Zellia().execute.call(context);
	return { items: output[0].map((item) => item.json), calls: context.calls };
}

const STAGES = {
	payload: [
		{ id: 6, name: 'Nuevo', stage_type: 'open', position: 1 },
		{ id: 9, name: 'Won', stage_type: 'won', position: 6 },
		{ id: 10, name: 'Lost', stage_type: 'lost', position: 7 },
	],
};

describe('helpers', () => {
	test('normalizePhone keeps digits and adds the plus sign', () => {
		assert.equal(normalizePhone(' +57 (300) 123-4567 '), '+573001234567');
		assert.equal(normalizePhone('573001234567'), '+573001234567');
		assert.equal(normalizePhone('abc'), '');
	});

	test('parseLabels trims, lowercases, drops empties and removes duplicates', () => {
		assert.deepEqual(parseLabels('VIP, ventas,,vip '), ['vip', 'ventas']);
		assert.deepEqual(parseLabels(['a', ' b', 'a']), ['a', 'b']);
		assert.deepEqual(parseLabels(undefined), []);
	});

	test('keyValuesToObject ignores rows without a key', () => {
		assert.deepEqual(
			keyValuesToObject({ values: [{ key: 'city', value: 'Bogotá' }, { key: ' ', value: 'x' }] }),
			{ city: 'Bogotá' },
		);
	});

	test('buildMultipart writes the fields and the file part', () => {
		const { body, contentType } = buildMultipart(
			{ content: 'hola', private: 'false' },
			{ field: 'attachments[]', fileName: 'a"b.pdf', mimeType: 'application/pdf', data: Buffer.from('PDF') },
		);
		const boundary = contentType.split('boundary=')[1];
		const text = body.toString();
		assert.match(text, /name="content"\r\n\r\nhola\r\n/);
		assert.match(text, /name="attachments\[\]"; filename="ab.pdf"\r\nContent-Type: application\/pdf\r\n\r\nPDF\r\n/);
		assert.ok(text.endsWith(`--${boundary}--\r\n`));
	});

	test('describeZelliaError explains the bot restriction', () => {
		const error = new HttpError(401, { error: 'Access to this endpoint is not authorized for bots' });
		assert.equal(describeZelliaError(error).message, 'This operation needs an agent token');
	});

	test('describeZelliaError reads the 422 message shape', () => {
		const error = new HttpError(422, JSON.stringify({ message: 'Phone number should be in e164 format', attributes: ['phone_number'] }));
		assert.equal(describeZelliaError(error).message, 'Phone number should be in e164 format');
	});
});

describe('message body', () => {
	const build = (params) => buildMessageBody.call(createContext({ params }), 0);

	test('text and private note', () => {
		assert.deepEqual(build({ messageKind: 'text', content: 'Hola' }), { message_type: 'outgoing', content: 'Hola' });
		assert.deepEqual(build({ messageKind: 'note', content: 'Interna' }), {
			message_type: 'outgoing',
			content: 'Interna',
			private: true,
		});
	});

	test('empty text fails with a clear error', () => {
		assert.throws(() => build({ messageKind: 'text', content: '  ' }), /content is empty/);
	});

	test('buttons default the value to the title', () => {
		const body = build({
			messageKind: 'buttons',
			content: '¿Qué prefieres?',
			buttons: { values: [{ title: 'Sí' }, { title: 'No', value: 'no' }, { title: '' }] },
		});
		assert.equal(body.content_type, 'input_select');
		assert.deepEqual(body.content_attributes.items, [
			{ title: 'Sí', value: 'Sí' },
			{ title: 'No', value: 'no' },
		]);
	});

	test('cards map link and reply buttons, and keep actions on every card', () => {
		const body = build({
			messageKind: 'cards',
			cards: {
				values: [
					{ title: 'A', buttonText: 'Ver', buttonType: 'link', buttonValue: 'https://x.test' },
					{ title: 'B', buttonText: 'Quiero', buttonType: 'postback', buttonValue: 'quiero_b' },
					{ title: 'C' },
				],
			},
		});
		assert.equal(body.content_type, 'cards');
		assert.deepEqual(body.content_attributes.items.map((card) => card.actions), [
			[{ type: 'link', text: 'Ver', uri: 'https://x.test' }],
			[{ type: 'postback', text: 'Quiero', payload: 'quiero_b' }],
			[],
		]);
	});

	test('numbered template variables go under body with 1-based keys', () => {
		const body = build({
			messageKind: 'template',
			templateName: 'aviso',
			templateLanguage: 'es',
			templateCategory: 'UTILITY',
			templateParamsFormat: 'positional',
			templatePositional: { values: [{ value: 'Ana' }, { value: 'mañana' }] },
		});
		assert.deepEqual(body.template_params, {
			name: 'aviso',
			category: 'UTILITY',
			language: 'es',
			processed_params: { body: { 1: 'Ana', 2: 'mañana' } },
		});
		assert.equal(body.content, undefined);
	});

	test('named template variables and options', () => {
		const body = build({
			messageKind: 'template',
			templateName: 'cotizacion',
			templateLanguage: 'es_CO',
			templateCategory: 'MARKETING',
			templateParamsFormat: 'named',
			templateNamed: { values: [{ key: 'nombre_cliente', value: 'Ana' }] },
			templateContent: 'Hola Ana',
			messageOptions: { replyToMessageId: 55, senderBotId: 3 },
		});
		assert.deepEqual(body.template_params.processed_params, { body: { nombre_cliente: 'Ana' } });
		assert.equal(body.content, 'Hola Ana');
		assert.deepEqual(body.content_attributes, { in_reply_to: 55 });
		assert.equal(body.sender_type, 'AgentBot');
		assert.equal(body.sender_id, 3);
	});
});

describe('conversation labels', () => {
	const routes = (current) => ({
		'GET /conversations/5/labels': { payload: current },
		'POST /conversations/5/labels': (call) => ({ payload: call.body.labels }),
	});

	test('add keeps the current labels', async () => {
		const { items, calls } = await execute(
			{ resource: 'conversation', operation: 'addLabels', conversationId: 5, labels: ['vendido', 'vip'] },
			routes(['vip', 'nuevo']),
		);
		assert.deepEqual(calls.at(-1).body, { labels: ['vip', 'nuevo', 'vendido'] });
		assert.deepEqual(items[0], { conversation_id: 5, labels: ['vip', 'nuevo', 'vendido'] });
	});

	test('remove keeps the others', async () => {
		const { calls } = await execute(
			{ resource: 'conversation', operation: 'removeLabels', conversationId: 5, labels: 'nuevo' },
			routes(['vip', 'nuevo']),
		);
		assert.deepEqual(calls.at(-1).body, { labels: ['vip'] });
	});

	test('remove matches labels regardless of case', async () => {
		const { calls } = await execute(
			{ resource: 'conversation', operation: 'removeLabels', conversationId: 5, labels: 'NUEVO' },
			routes(['vip', 'nuevo']),
		);
		assert.deepEqual(calls.at(-1).body, { labels: ['vip'] });
	});

	test('replace does not read first', async () => {
		const { calls } = await execute(
			{ resource: 'conversation', operation: 'setLabels', conversationId: 5, labels: ['solo'] },
			routes(['vip']),
		);
		assert.deepEqual(calls.map((call) => call.method), ['POST']);
	});

	test('custom attributes merge unless replace is on', async () => {
		const route = { 'POST /conversations/5/custom_attributes': (call) => ({ custom_attributes: call.body.custom_attributes }) };
		const { calls } = await execute(
			{ resource: 'conversation', operation: 'setAttributes', conversationId: 5, attributes: { values: [{ key: 'pago_estado', value: 'ok' }] } },
			route,
		);
		assert.deepEqual(calls[0].body, { custom_attributes: { pago_estado: 'ok' }, merge: true });
	});
});

describe('conversation status', () => {
	test('snoozed until is sent as epoch seconds', async () => {
		const { calls } = await execute(
			{ resource: 'conversation', operation: 'setStatus', conversationId: 5, status: 'snoozed', snoozedUntil: '2026-10-23T15:00:00.000Z' },
			{ 'POST /conversations/5/toggle_status': { payload: { success: true } } },
		);
		assert.deepEqual(calls[0].body, { status: 'snoozed', snoozed_until: 1792767600 });
	});
});

describe('start outbound conversation', () => {
	const base = {
		resource: 'conversation',
		operation: 'startOutbound',
		inboxId: '4',
		phone: '+57 300 123 4567',
		contactName: 'Ana',
		reuseOpenConversation: true,
		messageKind: 'text',
		content: 'Hola Ana',
	};

	test('creates the contact and the conversation when nothing exists', async () => {
		const { items, calls } = await execute(base, {
			'GET /contacts/search': { payload: [{ id: 1, phone_number: '+5730012345670' }] },
			'POST /contacts': { payload: { contact: { id: 22, phone_number: '+573001234567' } } },
			'GET /contacts/22/conversations': { payload: [] },
			'POST /conversations': { id: 300, inbox_id: 4 },
			'POST /conversations/300/messages': (call) => ({ id: 9000, content: call.body.content }),
		});
		assert.deepEqual(calls[1].body, { inbox_id: 4, name: 'Ana', phone_number: '+573001234567' });
		assert.equal(items[0].contactCreated, true);
		assert.equal(items[0].conversationCreated, true);
		assert.equal(items[0].message.id, 9000);
	});

	test('reuses the open conversation of the same inbox', async () => {
		const { items, calls } = await execute(base, {
			'GET /contacts/search': { payload: [{ id: 22, phone_number: '+573001234567' }] },
			'GET /contacts/22/conversations': {
				payload: [
					{ id: 10, inbox_id: 9, status: 'open' },
					{ id: 11, inbox_id: 4, status: 'resolved' },
					{ id: 12, inbox_id: 4, status: 'pending' },
				],
			},
			'POST /conversations/12/messages': { id: 1 },
		});
		assert.equal(items[0].contactCreated, false);
		assert.equal(items[0].conversationCreated, false);
		assert.ok(!calls.some((call) => call.path === '/conversations' && call.method === 'POST'));
	});
});

describe('deals', () => {
	const params = (operation, extra = {}) => ({ resource: 'deal', operation, pipelineId: '2', dealId: 77, ...extra });

	test('mark as won sets the amount, then moves to the won stage', async () => {
		const { items, calls } = await execute(params('markWon', { value: 850000, currency: 'cop' }), {
			'GET /pipelines/2/items/77': { payload: { id: 77, status: 'open', value: '0.0', currency: 'COP' } },
			'PATCH /pipelines/2/items/77': { payload: {} },
			'GET /pipelines/2/stages': STAGES,
			'POST /pipelines/2/items/77/move': { payload: { id: 77, status: 'won', value: '850000.0' } },
		});
		assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
			'GET /pipelines/2/items/77',
			'PATCH /pipelines/2/items/77',
			'GET /pipelines/2/stages',
			'POST /pipelines/2/items/77/move',
		]);
		assert.deepEqual(calls[1].body, { pipeline_item: { value: 850000 } });
		assert.deepEqual(calls[3].body, { pipeline_stage_id: 9 });
		assert.equal(items[0].alreadyInStage, false);
	});

	test('mark as won keeps the current amount when the field is 0', async () => {
		const { calls } = await execute(params('markWon', { value: 0, currency: '' }), {
			'GET /pipelines/2/items/77': { payload: { id: 77, status: 'open', value: '120.0', currency: 'COP' } },
			'GET /pipelines/2/stages': STAGES,
			'POST /pipelines/2/items/77/move': { payload: { id: 77, status: 'won' } },
		});
		assert.ok(!calls.some((call) => call.method === 'PATCH'));
	});

	test('mark as won without any amount fails before calling Zellia', async () => {
		await assert.rejects(
			execute(params('markWon', { value: 0 }), {
				'GET /pipelines/2/items/77': { payload: { id: 77, status: 'open', value: '0.0' } },
			}),
			/needs an amount above 0/,
		);
	});

	test('mark as won on a won deal changes nothing', async () => {
		const { items, calls } = await execute(params('markWon', { value: 5 }), {
			'GET /pipelines/2/items/77': { payload: { id: 77, status: 'won', value: '9.0' } },
		});
		assert.equal(calls.length, 1);
		assert.equal(items[0].alreadyInStage, true);
	});

	test('mark as lost moves to the lost stage', async () => {
		const { calls } = await execute(params('markLost'), {
			'GET /pipelines/2/items/77': { payload: { id: 77, status: 'open' } },
			'GET /pipelines/2/stages': STAGES,
			'POST /pipelines/2/items/77/move': { payload: { id: 77, status: 'lost' } },
		});
		assert.deepEqual(calls.at(-1).body, { pipeline_stage_id: 10 });
	});

	test('create returns the open deal instead of failing, and links the conversation', async () => {
		const { items, calls } = await execute(
			{ resource: 'deal', operation: 'create', pipelineId: '2', contactId: 5, onOpenDeal: 'returnExisting', additionalFields: { conversationId: 40 } },
			{
				'GET /contacts/5/pipeline_items': { payload: [{ id: 1, pipeline_id: 3, status: 'open' }, { id: 2, pipeline_id: 2, status: 'open' }] },
				'POST /pipelines/2/items/2/link_conversation': { payload: [] },
			},
		);
		assert.equal(items[0].id, 2);
		assert.equal(items[0].alreadyExisted, true);
		assert.equal(calls.at(-1).body.conversation_id, 40);
	});

	test('create fails on an open deal when asked to', async () => {
		await assert.rejects(
			execute(
				{ resource: 'deal', operation: 'create', pipelineId: '2', contactId: 5, onOpenDeal: 'error', additionalFields: {} },
				{ 'GET /contacts/5/pipeline_items': { payload: [{ id: 2, pipeline_id: 2, status: 'open' }] } },
			),
			/already has an open deal \(ID 2\)/,
		);
	});

	test('create wraps the body in pipeline_item', async () => {
		const { calls } = await execute(
			{ resource: 'deal', operation: 'create', pipelineId: '2', contactId: 5, onOpenDeal: 'error', additionalFields: { stageId: '6', value: 10, currency: 'usd' } },
			{
				'GET /contacts/5/pipeline_items': { payload: [{ id: 2, pipeline_id: 2, status: 'won' }] },
				'POST /pipelines/2/items': { payload: { id: 3 } },
			},
		);
		assert.deepEqual(calls[1].body, { pipeline_item: { contact_id: 5, pipeline_stage_id: 6, value: 10, currency: 'USD' } });
	});

	test('find by conversation resolves the contact and filters', async () => {
		const { items, calls } = await execute(
			{ resource: 'deal', operation: 'getForContact', findBy: 'conversation', conversationId: 40, contactFilters: { status: 'open', pipelineId: '2', onlyLinked: true } },
			{
				'GET /conversations/40': { id: 40, meta: { sender: { id: 5 } } },
				'GET /contacts/5/pipeline_items': {
					payload: [
						{ id: 1, pipeline_id: 2, status: 'won' },
						{ id: 2, pipeline_id: 2, status: 'open' },
						{ id: 3, pipeline_id: 8, status: 'open' },
					],
				},
			},
		);
		assert.deepEqual(items.map((deal) => deal.id), [2]);
		assert.deepEqual(calls[1].qs, { conversation_id: 40 });
	});
});

describe('contact upsert', () => {
	const params = (extra) => ({ resource: 'contact', operation: 'upsert', matchBy: 'phone', matchValue: '300 123 4567', contactData: {}, inboxId: '', ...extra });

	test('updates only the exact match', async () => {
		const { items, calls } = await execute(params({ matchValue: '+57 300 123 4567', contactData: { name: 'Ana' } }), {
			'GET /contacts/search': { payload: [{ id: 1, phone_number: '+5730012345678' }, { id: 2, phone_number: '+573001234567' }] },
			'PUT /contacts/2': { payload: { id: 2, name: 'Ana' } },
		});
		assert.equal(items[0].upsertResult, 'updated');
		assert.equal(calls[1].path, '/contacts/2');
	});

	test('creates when only fuzzy matches exist', async () => {
		const { items, calls } = await execute(params({ matchBy: 'email', matchValue: 'Ana@X.test', inboxId: '4' }), {
			'GET /contacts/search': { payload: [{ id: 1, email: 'ana@x.test.co' }] },
			'POST /contacts': { payload: { contact: { id: 9 }, contact_inbox: { source_id: 's' } } },
		});
		assert.deepEqual(calls[1].body, { email: 'ana@x.test', inbox_id: 4 });
		assert.equal(items[0].upsertResult, 'created');
		assert.deepEqual(items[0].contact_inbox, { source_id: 's' });
	});

	test('follows the search pages to find the exact match', async () => {
		const { items } = await execute(params({ matchBy: 'identifier', matchValue: 'C1' }), {
			'GET /contacts/search': (call) =>
				call.qs.page === 1
					? { meta: { has_more: true }, payload: [{ id: 1, identifier: 'C10' }] }
					: { meta: { has_more: false }, payload: [{ id: 2, identifier: 'C1' }] },
		});
		assert.equal(items[0].id, 2);
		assert.equal(items[0].upsertResult, 'found');
	});

	test('returns the contact untouched when there is nothing to update', async () => {
		const { items, calls } = await execute(params({ matchValue: '+573001234567' }), {
			'GET /contacts/search': { payload: [{ id: 2, phone_number: '+573001234567' }] },
		});
		assert.equal(items[0].upsertResult, 'found');
		assert.equal(calls.length, 1);
	});
});

describe('errors', () => {
	test('a bot token on an agent-only endpoint gives a clear message', async () => {
		await assert.rejects(
			execute({ resource: 'contact', operation: 'search', query: 'ana', returnAll: true }, {
				'GET /contacts/search': () => {
					throw new HttpError(401, { error: 'Access to this endpoint is not authorized for bots' });
				},
			}),
			/needs an agent token/,
		);
	});
});
