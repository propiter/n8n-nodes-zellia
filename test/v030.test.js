'use strict';
// Behaviour added in 0.3.0. Written before the implementation (TDD).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { Zellia } = require('../dist/nodes/Zellia/Zellia.node.js');
const { ZelliaTrigger } = require('../dist/nodes/ZelliaTrigger/ZelliaTrigger.node.js');
const { ZelliaToolTrigger } = require('../dist/nodes/ZelliaToolTrigger/ZelliaToolTrigger.node.js');
const { simplifyEvent } = require('../dist/nodes/ZelliaTrigger/simplify.js');
const { normalizePhone, describeZelliaError } = require('../dist/nodes/Zellia/GenericFunctions.js');
const { buildMessageBody } = require('../dist/nodes/Zellia/actions/message.js');
const { createContext, HttpError } = require('./helpers');

async function execute(params, routes, extra = {}) {
	const context = createContext({ params, routes, ...extra });
	const output = await new Zellia().execute.call(context);
	return { items: output[0].map((item) => item.json), calls: context.calls };
}

const STAGES = {
	payload: [
		{ id: 6, name: 'Nuevo', stage_type: 'open', position: 1 },
		{ id: 7, name: 'Cotizado', stage_type: 'open', position: 2 },
		{ id: 8, name: 'Seguimiento', stage_type: 'open', position: 3 },
		{ id: 9, name: 'Ganado', stage_type: 'won', position: 4 },
		{ id: 10, name: 'Perdido', stage_type: 'lost', position: 5 },
	],
};

describe('phone numbers with a default country code', () => {
	test('a national number gets the country code', () => {
		assert.equal(normalizePhone('300 123 4567', '57'), '+573001234567');
		assert.equal(normalizePhone('(300) 123-4567', '+57'), '+573001234567');
	});

	test('a number that already has the code or a plus is kept', () => {
		assert.equal(normalizePhone('573001234567', '57'), '+573001234567');
		assert.equal(normalizePhone('+1 415 555 0100', '57'), '+14155550100');
		assert.equal(normalizePhone('0057 300 123 4567', '57'), '+573001234567');
	});

	test('without a default country code the old behaviour stays', () => {
		assert.equal(normalizePhone('3001234567'), '+3001234567');
		assert.equal(normalizePhone('3001234567', ''), '+3001234567');
	});

	test('start outbound uses the credential country code', async () => {
		const { calls } = await execute(
			{ resource: 'conversation', operation: 'startOutbound', inboxId: '4', phone: '300 123 4567', contactName: 'Ana', reuseOpenConversation: false, messageKind: 'text', content: 'Hola' },
			{
				'GET /contacts/search': { meta: { has_more: false }, payload: [] },
				'POST /contacts': { payload: { contact: { id: 22 } } },
				'POST /conversations': { id: 300 },
				'POST /conversations/300/messages': { id: 1 },
			},
			{ credentials: { defaultCountryCode: '57' } },
		);
		assert.equal(calls[0].qs.q, '+573001234567');
		assert.equal(calls[1].body.phone_number, '+573001234567');
	});
});

describe('deal custom attributes', () => {
	const base = { resource: 'deal', operation: 'update', pipelineId: '2', dealId: 7 };

	test('update merges the attributes with the current ones', async () => {
		const { calls } = await execute(
			{ ...base, updateFields: { customAttributes: { values: [{ key: 'motivo', value: 'precio' }] } } },
			{
				'GET /pipelines/2/items/7': { payload: { id: 7, custom_attributes: { origen: 'web', motivo: 'x' } } },
				'PATCH /pipelines/2/items/7': (call) => ({ payload: { id: 7, custom_attributes: call.body.pipeline_item.custom_attributes } }),
			},
		);
		assert.deepEqual(calls.at(-1).body, { pipeline_item: { custom_attributes: { origen: 'web', motivo: 'precio' } } });
	});

	test('replace mode sends only the given attributes and does not read first', async () => {
		const { calls } = await execute(
			{ ...base, updateFields: { customAttributes: { values: [{ key: 'motivo', value: 'precio' }] }, replaceAttributes: true } },
			{ 'PATCH /pipelines/2/items/7': (call) => ({ payload: { id: 7, custom_attributes: call.body.pipeline_item.custom_attributes } }) },
		);
		assert.deepEqual(calls.map((call) => call.method), ['PATCH']);
		assert.deepEqual(calls[0].body.pipeline_item.custom_attributes, { motivo: 'precio' });
	});

	test('a bot token that Zellia silently ignores stops with a clear error', async () => {
		await assert.rejects(
			execute(
				{ ...base, updateFields: { customAttributes: { values: [{ key: 'motivo', value: 'precio' }] } } },
				{
					'GET /pipelines/2/items/7': { payload: { id: 7, custom_attributes: {} } },
					'PATCH /pipelines/2/items/7': { payload: { id: 7, custom_attributes: {} } },
				},
			),
			/Zellia did not save the custom attributes/,
		);
	});

	test('mark as lost can save the reason in an attribute', async () => {
		const { calls, items } = await execute(
			{ resource: 'deal', operation: 'markLost', pipelineId: '2', dealLookup: 'dealId', dealId: 7, lostReason: 'Precio alto', lostReasonKey: 'motivo_de_perdida' },
			{
				'GET /pipelines/2/items/7': { payload: { id: 7, status: 'open', custom_attributes: { origen: 'web' } } },
				'GET /pipelines/2/stages': STAGES,
				'POST /pipelines/2/items/7/move': { payload: { id: 7, status: 'lost', custom_attributes: { origen: 'web' } } },
				'PATCH /pipelines/2/items/7': (call) => ({ payload: { id: 7, status: 'lost', custom_attributes: call.body.pipeline_item.custom_attributes } }),
			},
		);
		const patch = calls.find((call) => call.method === 'PATCH');
		assert.deepEqual(patch.body.pipeline_item.custom_attributes, { origen: 'web', motivo_de_perdida: 'Precio alto' });
		assert.ok(calls.indexOf(patch) < calls.findIndex((call) => call.path.endsWith('/move')));
		assert.equal(items[0].result, 'lost');
	});
});

describe('deal creation races with Zellia routing', () => {
	test('an open deal created by Zellia in the meantime is returned, not an error', async () => {
		let reads = 0;
		const { items } = await execute(
			{ resource: 'deal', operation: 'create', pipelineId: '2', contactId: 5, onOpenDeal: 'returnExisting', additionalFields: {} },
			{
				'GET /contacts/5/pipeline_items': () => ({ payload: ++reads === 1 ? [] : [{ id: 44, pipeline_id: 2, status: 'open' }] }),
				'POST /pipelines/2/items': () => {
					throw new HttpError(422, { message: 'Contact already has an open deal in this pipeline', attributes: ['contact_id'] });
				},
			},
		);
		assert.equal(items[0].id, 44);
		assert.equal(items[0].alreadyExisted, true);
	});

	test('the conflict is detected in any language', async () => {
		let reads = 0;
		const { items } = await execute(
			{ resource: 'deal', operation: 'create', pipelineId: '2', contactId: 5, onOpenDeal: 'returnExisting', additionalFields: {} },
			{
				'GET /contacts/5/pipeline_items': () => ({ payload: ++reads === 1 ? [] : [{ id: 45, pipeline_id: 2, status: 'open' }] }),
				'POST /pipelines/2/items': () => {
					throw new HttpError(422, { message: 'Contacto ya tiene un negocio abierto en este embudo', attributes: ['contact_id'] });
				},
			},
		);
		assert.equal(items[0].id, 45);
	});

	test('a real creation error is still reported', async () => {
		await assert.rejects(
			execute(
				{ resource: 'deal', operation: 'create', pipelineId: '2', contactId: 5, onOpenDeal: 'returnExisting', additionalFields: {} },
				{
					'GET /contacts/5/pipeline_items': { payload: [] },
					'POST /pipelines/2/items': () => {
						throw new HttpError(422, { message: 'Currency is invalid', attributes: ['currency'] });
					},
				},
			),
			/Currency is invalid/,
		);
	});

	test('find by conversation can wait for Zellia to open the deal', async () => {
		let reads = 0;
		const { items } = await execute(
			{ resource: 'deal', operation: 'getForContact', findBy: 'contact', contactId: 5, contactFilters: { waitSeconds: 2 } },
			{ 'GET /contacts/5/pipeline_items': () => ({ payload: ++reads < 2 ? [] : [{ id: 44, pipeline_id: 2, status: 'open' }] }) },
		);
		assert.equal(items[0].id, 44);
		assert.ok(reads >= 2);
	});
});

describe('stages', () => {
	const routes = (stageId) => ({
		'GET /pipelines/2/items/7': { payload: { id: 7, status: 'open', pipeline_stage_id: stageId } },
		'GET /pipelines/2/stages': STAGES,
		'POST /pipelines/2/items/7/move': (call) => ({ payload: { id: 7, pipeline_stage_id: call.body.pipeline_stage_id } }),
	});
	const params = (extra) => ({ resource: 'deal', operation: 'moveToStage', pipelineId: '2', dealId: 7, stageId: '6', ...extra });

	test('only forward refuses to move a deal back', async () => {
		const { items, calls } = await execute(params({ onlyForward: true }), routes(8));
		assert.equal(items[0].result, 'skipped_backward');
		assert.ok(!calls.some((call) => call.path.endsWith('/move')));
	});

	test('only forward still moves ahead, and the result says moved', async () => {
		const { items } = await execute(params({ onlyForward: true, stageId: '8' }), routes(6));
		assert.equal(items[0].result, 'moved');
	});

	test('a move to the current stage does nothing', async () => {
		const { items, calls } = await execute(params({ stageId: '8' }), routes(8));
		assert.equal(items[0].result, 'already_in_stage');
		assert.ok(!calls.some((call) => call.path.endsWith('/move')));
	});
});

describe('register sale', () => {
	test('uses the register_sale endpoint with the amount', async () => {
		const { items, calls } = await execute(
			{ resource: 'deal', operation: 'registerSale', pipelineId: '2', dealLookup: 'dealId', dealId: 7, value: 850000 },
			{
				'GET /pipelines/2/items/7': { payload: { id: 7, status: 'open', value: '0.0' } },
				'POST /pipelines/2/items/7/register_sale': { payload: { id: 7, status: 'won', value: '850000.0' } },
			},
		);
		assert.deepEqual(calls.at(-1).body, { value: 850000 });
		assert.equal(items[0].result, 'won');
	});

	test('repeating a sale with the same amount says already_won', async () => {
		const { items, calls } = await execute(
			{ resource: 'deal', operation: 'registerSale', pipelineId: '2', dealLookup: 'dealId', dealId: 7, value: 850000 },
			{
				'GET /pipelines/2/items/7': { payload: { id: 7, status: 'won', value: '850000.0' } },
				'POST /pipelines/2/items/7/register_sale': { payload: { id: 7, status: 'won', value: '850000.0' } },
			},
		);
		// Zellia still decides: the POST is sent and it keeps its own amount check
		assert.equal(calls.at(-1).path, '/pipelines/2/items/7/register_sale');
		assert.equal(items[0].result, 'already_won');
	});

	test('a different amount on a won deal is explained', async () => {
		await assert.rejects(
			execute(
				{ resource: 'deal', operation: 'registerSale', pipelineId: '2', dealLookup: 'dealId', dealId: 7, value: 1 },
				{
					'GET /pipelines/2/items/7': { payload: { id: 7, status: 'won', value: '9.0' } },
					'POST /pipelines/2/items/7/register_sale': () => {
						throw new HttpError(422, { message: 'This deal is already won with a different amount', attributes: [] });
					},
				},
			),
			/already won with a different amount/,
		);
	});

	test('mark as won says when the won amount differs', async () => {
		const { items } = await execute(
			{ resource: 'deal', operation: 'markWon', pipelineId: '2', dealLookup: 'dealId', dealId: 7, value: 5 },
			{ 'GET /pipelines/2/items/7': { payload: { id: 7, status: 'won', value: '9.0' } } },
		);
		assert.equal(items[0].result, 'already_won');
		assert.equal(items[0].amountDiffers, true);
	});
});

describe('WhatsApp templates with header and buttons', () => {
	const base = {
		messageKind: 'template', templateName: 'cotizacion', templateLanguage: 'es', templateCategory: 'UTILITY',
		templateParamsFormat: 'positional', templatePositional: { values: [{ value: 'Ana' }] },
	};
	const build = (params) => buildMessageBody.call(createContext({ params }), 0);

	test('a media header and a URL button are sent in the component format', () => {
		const body = build({
			...base,
			templateHeader: { type: 'media', mediaType: 'image', mediaUrl: 'https://x.test/a.png', mediaName: '' },
			templateButtons: { values: [{ index: 1, type: 'url', parameter: 'ord-123' }] },
		});
		assert.deepEqual(body.template_params.processed_params, {
			body: { 1: 'Ana' },
			header: { media_url: 'https://x.test/a.png', media_type: 'image' },
			buttons: [{ type: 'quick_reply' }, { type: 'url', parameter: 'ord-123' }],
		});
	});

	test('a text header uses numbered variables', () => {
		const body = build({ ...base, templateHeader: { type: 'text', textVariables: 'Pedido 45' } });
		assert.deepEqual(body.template_params.processed_params.header, { 1: 'Pedido 45' });
	});

	test('without header or buttons the body stays as before', () => {
		assert.deepEqual(build(base).template_params.processed_params, { body: { 1: 'Ana' } });
	});
});

describe('simplify', () => {
	test('conversation events keep the last message', () => {
		const result = simplifyEvent({
			event: 'conversation_created', id: 5, inbox_id: 2, status: 'open', labels: [], account: { id: 23 },
			meta: { sender: { id: 1, name: 'Ana' } },
			messages: [{ id: 99, content: 'Hola, ref EST-1', message_type: 0, private: false, sender: { type: 'contact' } }],
		});
		assert.equal(result.last_message_id, 99);
		assert.equal(result.text, 'Hola, ref EST-1');
	});
});

describe('trigger lifecycle', () => {
	test('changed events update the existing webhook instead of deleting it', async () => {
		const context = createContext({
			params: { source: 'webhook', events: ['message_created'], inboxId: '' },
			routes: {
				'GET /webhooks': { payload: { webhooks: [{ id: 12, url: 'https://n8n.test/webhook/abc/webhook', subscriptions: ['message_updated'], secret: 's' }] } },
				'PATCH /webhooks/12': (call) => ({ payload: { webhook: { id: 12, secret: 's', subscriptions: call.body.webhook.subscriptions } } }),
			},
		});
		context.staticData.webhookId = 12;
		assert.equal(await new ZelliaTrigger().webhookMethods.default.checkExists.call(context), true);
		assert.deepEqual(context.calls.map((call) => call.method), ['GET', 'PATCH']);
		assert.deepEqual(context.calls[1].body.webhook.subscriptions, ['message_created']);
		assert.equal(context.staticData.webhookSecret, 's');
	});
});

describe('Captain tool trigger answer', () => {
	test('it can answer at once with a fixed text', () => {
		const [webhook] = new ZelliaToolTrigger().description.webhooks;
		assert.match(webhook.responseMode, /responseMode/);
		assert.ok(new ZelliaToolTrigger().description.properties.some((p) => p.name === 'immediateAnswer'));
	});
});

describe('trigger secrets from a credential', () => {
	test('the automation token can come from a credential', async () => {
		const context = createContext({
			params: { source: 'automation', secretSource: 'credential', simplify: false },
			credentials: { zelliaWebhookSecretApi: { secret: 's3cret' } },
		});
		const response = {};
		Object.assign(context, {
			getBodyData: () => ({ event: 'automation_event.x' }),
			getQueryData: () => ({ token: 's3cret' }),
			getRequestObject: () => ({ headers: {} }),
			getResponseObject: () => ({ status(code) { response.status = code; return this; }, json() {} }),
		});
		const result = await new ZelliaTrigger().webhook.call(context);
		assert.equal(result.workflowData[0].length, 1);
	});
});

describe('error messages', () => {
	test('rate limits and server errors say what to do', () => {
		assert.match(describeZelliaError(new HttpError(429, '')).message, /too many requests/i);
		assert.match(describeZelliaError(new HttpError(503, '')).message, /Zellia is not available/i);
	});

	test('a 422 with message and attributes keeps the message', () => {
		assert.equal(describeZelliaError(new HttpError(422, { message: 'Value must be greater than 0', attributes: ['value'] })).message, 'Value must be greater than 0');
	});
});

describe('review fixes', () => {
	const STAGES_MIXED = {
		payload: [
			{ id: 9, name: 'Ganado', stage_type: 'won', position: 0 },
			{ id: 6, name: 'Nuevo', stage_type: 'open', position: 1 },
			{ id: 8, name: 'Seguimiento', stage_type: 'open', position: 3 },
			{ id: 10, name: 'Perdido', stage_type: 'lost', position: 2 },
		],
	};

	test('a single button at position 1 keeps a valid template', () => {
		const body = buildMessageBody.call(createContext({ params: {
			messageKind: 'template', templateName: 't', templateLanguage: 'es', templateCategory: 'UTILITY',
			templateParamsFormat: 'positional', templatePositional: { values: [{ value: 'Ana' }] },
			templateButtons: { values: [{ index: 1, type: 'url', parameter: 'x1' }] },
		} }), 0);
		const buttons = body.template_params.processed_params.buttons;
		assert.ok(buttons.every((button) => button.type), JSON.stringify(buttons));
		assert.deepEqual(buttons[1], { type: 'url', parameter: 'x1' });
	});

	test('a media header without a type is still sent as a file', () => {
		const body = buildMessageBody.call(createContext({ params: {
			messageKind: 'template', templateName: 't', templateLanguage: 'es', templateCategory: 'UTILITY',
			templateParamsFormat: 'positional', templatePositional: { values: [] },
			templateHeader: { mediaUrl: 'https://x.test/a.pdf', mediaType: 'document' },
		} }), 0);
		assert.deepEqual(body.template_params.processed_params.header, { media_url: 'https://x.test/a.pdf', media_type: 'document' });
	});

	test('a wait value that is not a number does not loop', async () => {
		const started = Date.now();
		await execute(
			{ resource: 'deal', operation: 'getForContact', findBy: 'contact', contactId: 5, contactFilters: { waitSeconds: 'abc' } },
			{ 'GET /contacts/5/pipeline_items': { payload: [] } },
		);
		assert.ok(Date.now() - started < 1500);
	});

	test('the trunk 0 of a national number is removed', () => {
		assert.equal(normalizePhone('0991234567', '593'), '+593991234567');
		assert.equal(normalizePhone('07911 123456', '44'), '+447911123456');
	});

	test('only forward follows the server order and never moves a closed deal', async () => {
		const routes = (stageId, status) => ({
			'GET /pipelines/2/items/7': { payload: { id: 7, status, pipeline_stage_id: stageId } },
			'GET /pipelines/2/stages': STAGES_MIXED,
			'POST /pipelines/2/items/7/move': (call) => ({ payload: { id: 7, pipeline_stage_id: call.body.pipeline_stage_id } }),
		});
		const params = (stageId) => ({ resource: 'deal', operation: 'moveToStage', pipelineId: '2', dealId: 7, stageId, onlyForward: true });
		assert.equal((await execute(params('9'), routes(8, 'open'))).items[0].result, 'moved');
		assert.equal((await execute(params('6'), routes(9, 'won'))).items[0].result, 'skipped_closed');
		assert.equal((await execute(params('10'), routes(9, 'won'))).items[0].result, 'skipped_closed');
		assert.equal((await execute(params('6'), routes(8, 'open'))).items[0].result, 'skipped_backward');
	});

	test('mark as lost saves the reason before moving, so a bot fails before any change', async () => {
		const { calls } = await execute(
			{ resource: 'deal', operation: 'markLost', pipelineId: '2', dealLookup: 'dealId', dealId: 7, lostReason: 'Precio', lostReasonKey: 'motivo' },
			{
				'GET /pipelines/2/items/7': { payload: { id: 7, status: 'open', custom_attributes: {} } },
				'PATCH /pipelines/2/items/7': { payload: { id: 7, custom_attributes: {} } },
			},
		).catch((error) => ({ calls: error.calls || [], error }));
		assert.ok(!(calls || []).some((call) => call.path && call.path.endsWith('/move')));
		await assert.rejects(
			execute(
				{ resource: 'deal', operation: 'markLost', pipelineId: '2', dealLookup: 'dealId', dealId: 7, lostReason: 'Precio', lostReasonKey: 'motivo' },
				{
					'GET /pipelines/2/items/7': { payload: { id: 7, status: 'open', custom_attributes: {} } },
					'PATCH /pipelines/2/items/7': { payload: { id: 7, custom_attributes: {} } },
					'POST /pipelines/2/items/7/move': () => { throw new Error('must not move'); },
				},
			),
			/did not save the custom attributes/,
		);
	});

	test('register sale by conversation on a deal already won uses the same server rules', async () => {
		const { calls, items } = await execute(
			{ resource: 'deal', operation: 'registerSale', pipelineId: '2', dealLookup: 'conversation', conversationId: 40, value: 900 },
			{
				'GET /conversations/40': { id: 40, meta: { sender: { id: 5 } } },
				'GET /contacts/5/pipeline_items': (call) => ({ payload: call.qs && call.qs.conversation_id ? [{ id: 7, pipeline_id: 2, status: 'won' }] : [] }),
				'GET /pipelines/2/items/7': { payload: { id: 7, status: 'won', value: '900.0' } },
				'POST /pipelines/2/items/7/register_sale': { payload: { id: 7, status: 'won', value: '900.0' } },
			},
		);
		assert.equal(calls.at(-1).path, '/pipelines/2/items/7/register_sale');
		assert.equal(items[0].result, 'already_won');
	});

	test('waiting without a status filter waits for an open deal, not an old one', async () => {
		let reads = 0;
		const { items } = await execute(
			{ resource: 'deal', operation: 'getForContact', findBy: 'contact', contactId: 5, contactFilters: { waitSeconds: 3 } },
			{ 'GET /contacts/5/pipeline_items': () => ({ payload: ++reads < 2 ? [{ id: 1, pipeline_id: 2, status: 'won' }] : [{ id: 1, pipeline_id: 2, status: 'won' }, { id: 2, pipeline_id: 2, status: 'open' }] }) },
		);
		assert.ok(items.some((deal) => deal.status === 'open'));
	});
});

describe('webhook secret credential test', () => {
	const { testWebhookSecret } = require('../dist/nodes/ZelliaTrigger/secretTest.js');
	test('short secrets are refused and long ones pass', async () => {
		assert.equal((await testWebhookSecret.call({}, { data: { secret: 'short' } })).status, 'Error');
		assert.equal((await testWebhookSecret.call({}, { data: { secret: 'a'.repeat(32) } })).status, 'OK');
	});
});
