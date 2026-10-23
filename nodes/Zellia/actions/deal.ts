import type { IDataObject, IExecuteFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import {
	asArray,
	keyValuesToObject,
	unwrapPayload,
	zelliaApiRequest,
	zelliaApiRequestAllItems,
} from '../GenericFunctions';

// Upper bound for the optional wait while Zellia opens a deal for a new conversation
const MAX_WAIT_SECONDS = 30;

async function getStages(this: IExecuteFunctions, pipelineId: number): Promise<IDataObject[]> {
	return asArray(
		(await zelliaApiRequest.call(this, 'GET', `/pipelines/${pipelineId}/stages`)).payload,
	);
}

async function findStageByType(
	this: IExecuteFunctions,
	pipelineId: number,
	stageType: 'won' | 'lost',
	i: number,
): Promise<IDataObject> {
	const stage = (await getStages.call(this, pipelineId)).find(
		(candidate) => candidate.stage_type === stageType,
	);
	if (!stage) {
		throw new NodeOperationError(this.getNode(), `The pipeline has no ${stageType} stage`, {
			itemIndex: i,
		});
	}
	return stage;
}

async function moveDeal(
	this: IExecuteFunctions,
	itemsPath: string,
	dealId: number,
	stageId: number,
): Promise<IDataObject> {
	const response = await zelliaApiRequest.call(this, 'POST', `${itemsPath}/${dealId}/move`, {
		pipeline_stage_id: stageId,
	});
	return unwrapPayload(response);
}

async function getDeal(this: IExecuteFunctions, itemsPath: string, dealId: number) {
	return unwrapPayload(await zelliaApiRequest.call(this, 'GET', `${itemsPath}/${dealId}`));
}

/**
 * PATCHes a deal and checks that Zellia kept what was sent. Zellia answers 200 but drops
 * custom attributes and the assignee when the token belongs to an agent bot.
 */
async function patchDeal(
	this: IExecuteFunctions,
	itemsPath: string,
	dealId: number,
	changes: IDataObject,
	i: number,
): Promise<IDataObject> {
	const saved = unwrapPayload(
		await zelliaApiRequest.call(this, 'PATCH', `${itemsPath}/${dealId}`, {
			pipeline_item: changes,
		}),
	);
	const sentAttributes = (changes.custom_attributes as IDataObject | undefined) ?? {};
	const savedAttributes = (saved.custom_attributes as IDataObject | undefined) ?? {};
	const comparable = (value: unknown) =>
		value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
	const attributesLost = Object.keys(sentAttributes).some(
		(key) => comparable(savedAttributes[key]) !== comparable(sentAttributes[key]),
	);
	if (attributesLost) {
		throw new NodeOperationError(this.getNode(), 'Zellia did not save the custom attributes', {
			itemIndex: i,
			description:
				'Agent bot tokens can only change the amount and currency of a deal. Use a credential with an agent token.',
		});
	}
	const assignee = saved.assignee as IDataObject | undefined;
	if (changes.assignee_id !== undefined && Number(assignee?.id) !== Number(changes.assignee_id)) {
		throw new NodeOperationError(this.getNode(), 'Zellia did not change the agent of the deal', {
			itemIndex: i,
			description: 'Agent bot tokens cannot assign deals. Use a credential with an agent token.',
		});
	}
	return saved;
}

/** Custom attributes to send: merged with the current ones unless replace is on. */
async function attributesToSave(
	this: IExecuteFunctions,
	itemsPath: string,
	dealId: number,
	attributes: IDataObject,
	replace: boolean,
	current?: IDataObject,
): Promise<IDataObject> {
	if (replace) return attributes;
	// Zellia replaces the whole hash on PATCH, so the node merges first
	const deal = current ?? (await getDeal.call(this, itemsPath, dealId));
	return { ...((deal.custom_attributes as IDataObject | undefined) ?? {}), ...attributes };
}

async function markWon(
	this: IExecuteFunctions,
	pipelineId: number,
	itemsPath: string,
	dealId: number,
	i: number,
): Promise<IDataObject> {
	const deal = await getDeal.call(this, itemsPath, dealId);
	const value = Number(this.getNodeParameter('value', i, 0));
	const currentValue = Number(deal.value ?? 0);
	if (deal.status === 'won') {
		return {
			...deal,
			alreadyInStage: true,
			result: 'already_won',
			amountDiffers: value > 0 && value !== currentValue,
		};
	}

	const currency = String(this.getNodeParameter('currency', i, '') ?? '')
		.trim()
		.toUpperCase();
	const changes: IDataObject = {};
	if (value > 0 && value !== currentValue) changes.value = value;
	if (currency && currency !== deal.currency) changes.currency = currency;
	if (!(value > 0) && !(currentValue > 0)) {
		throw new NodeOperationError(this.getNode(), 'A won deal needs an amount above 0', {
			itemIndex: i,
			description: 'Set the Amount field, or give the deal an amount before you mark it as won.',
		});
	}
	// Agent bots cannot call register_sale, so set the amount and move in two steps
	if (Object.keys(changes).length) await patchDeal.call(this, itemsPath, dealId, changes, i);
	const wonStage = await findStageByType.call(this, pipelineId, 'won', i);
	return {
		...(await moveDeal.call(this, itemsPath, dealId, Number(wonStage.id))),
		alreadyInStage: false,
		result: 'won',
		amountDiffers: false,
	};
}

async function markLost(
	this: IExecuteFunctions,
	pipelineId: number,
	itemsPath: string,
	dealId: number,
	i: number,
): Promise<IDataObject> {
	const deal = await getDeal.call(this, itemsPath, dealId);
	const reason = String(this.getNodeParameter('lostReason', i, '') ?? '').trim();
	const reasonKey = String(this.getNodeParameter('lostReasonKey', i, '') ?? '').trim();
	let attributes = deal.custom_attributes as IDataObject | undefined;
	// The reason is saved first: with a bot token it fails before the deal moves
	if (reason && reasonKey) {
		const merged = await attributesToSave.call(
			this,
			itemsPath,
			dealId,
			{ [reasonKey]: reason },
			false,
			deal,
		);
		const saved = await patchDeal.call(this, itemsPath, dealId, { custom_attributes: merged }, i);
		attributes = saved.custom_attributes as IDataObject | undefined;
	}
	if (deal.status === 'lost') {
		return { ...deal, custom_attributes: attributes, alreadyInStage: true, result: 'already_lost' };
	}
	const lostStage = await findStageByType.call(this, pipelineId, 'lost', i);
	return {
		...(await moveDeal.call(this, itemsPath, dealId, Number(lostStage.id))),
		alreadyInStage: false,
		result: 'lost',
	};
}

async function registerSale(
	this: IExecuteFunctions,
	itemsPath: string,
	dealId: number,
	i: number,
): Promise<IDataObject> {
	const value = Number(this.getNodeParameter('value', i, 0));
	if (!(value > 0)) {
		throw new NodeOperationError(this.getNode(), 'A sale needs an amount above 0', {
			itemIndex: i,
		});
	}
	// One locked step in Zellia: sets the amount and wins the deal. The same amount again is a no-op.
	const deal = unwrapPayload(
		await zelliaApiRequest.call(this, 'POST', `${itemsPath}/${dealId}/register_sale`, { value }),
	);
	return { ...deal, result: 'won' };
}

/** Reads the contact's deals, waiting up to waitSeconds for one to appear. */
async function contactDeals(
	this: IExecuteFunctions,
	contactId: number,
	qs: IDataObject,
	accept: (deals: IDataObject[]) => boolean,
	waitSeconds: number,
): Promise<IDataObject[]> {
	// An expression can give a non-number; treat it as no wait so the loop always ends
	const seconds = Number.isFinite(Number(waitSeconds)) ? Number(waitSeconds) : 0;
	const deadline = Date.now() + Math.min(Math.max(seconds, 0), MAX_WAIT_SECONDS) * 1000;
	for (;;) {
		const response = await zelliaApiRequest.call(
			this,
			'GET',
			`/contacts/${contactId}/pipeline_items`,
			undefined,
			qs,
		);
		const deals = asArray(response.payload);
		if (accept(deals) || Date.now() >= deadline) return deals;
		// Zellia opens deals for new conversations asynchronously, usually within a second or two
		await sleep(1000);
	}
}

async function contactOfConversation(this: IExecuteFunctions, conversationId: number, i: number) {
	const conversation = await zelliaApiRequest.call(this, 'GET', `/conversations/${conversationId}`);
	const sender = (conversation.meta as IDataObject | undefined)?.sender as IDataObject | undefined;
	const contactId = Number(sender?.id);
	if (!Number.isFinite(contactId) || contactId <= 0) {
		throw new NodeOperationError(this.getNode(), 'The conversation has no contact', {
			itemIndex: i,
		});
	}
	return contactId;
}

/**
 * Finds the deal to close from a conversation: the contact's open deal in the pipeline.
 * When there is none, returns the output to send instead (already closed here, or no deal).
 */
async function findDealForConversation(
	this: IExecuteFunctions,
	pipelineId: number,
	target: 'won' | 'lost',
	i: number,
): Promise<{ dealId: number; output?: undefined } | { dealId?: undefined; output: IDataObject }> {
	const conversationId = this.getNodeParameter('conversationId', i) as number;
	const waitSeconds = Number(this.getNodeParameter('waitSeconds', i, 0) || 0);
	const contactId = await contactOfConversation.call(this, conversationId, i);
	const inPipeline = (deals: IDataObject[]) =>
		deals.filter((deal) => Number(deal.pipeline_id) === pipelineId);

	const deals = inPipeline(
		await contactDeals.call(
			this,
			contactId,
			{},
			(list) => inPipeline(list).some((deal) => deal.status === 'open'),
			waitSeconds,
		),
	);

	// Zellia allows one open deal per contact in each pipeline
	const open = deals.find((deal) => deal.status === 'open');
	if (open) return { dealId: Number(open.id) };

	// Linked deals include the ones where this conversation is not the main one
	const linked = await zelliaApiRequest.call(
		this,
		'GET',
		`/contacts/${contactId}/pipeline_items`,
		undefined,
		{ conversation_id: conversationId },
	);
	// A deal this conversation already closed goes through the same operation, so the rules
	// (amount check, idempotency, reason) are the same as with a deal ID
	const done = inPipeline(asArray(linked.payload)).find((deal) => deal.status === target);
	if (done) return { dealId: Number(done.id) };
	return { output: { result: 'no_deal', conversation_id: conversationId, contact_id: contactId } };
}

async function createDeal(
	this: IExecuteFunctions,
	pipelineId: number,
	itemsPath: string,
	i: number,
): Promise<IDataObject> {
	const contactId = this.getNodeParameter('contactId', i) as number;
	const onOpenDeal = this.getNodeParameter('onOpenDeal', i) as string;
	const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const conversationId = Number(additional.conversationId ?? 0);
	const findOpen = async () =>
		asArray(
			(await zelliaApiRequest.call(this, 'GET', `/contacts/${contactId}/pipeline_items`)).payload,
		).find((deal) => Number(deal.pipeline_id) === pipelineId && deal.status === 'open');
	const refuse = (deal: IDataObject) =>
		new NodeOperationError(
			this.getNode(),
			`The contact already has an open deal (ID ${deal.id}) in this pipeline`,
			{ itemIndex: i },
		);

	let deal: IDataObject | undefined = await findOpen();
	let alreadyExisted = !!deal;
	if (deal && onOpenDeal === 'error') throw refuse(deal);

	if (!deal) {
		const item: IDataObject = { contact_id: contactId };
		if (additional.stageId) item.pipeline_stage_id = Number(additional.stageId);
		if (Number(additional.value) > 0) item.value = Number(additional.value);
		if (additional.currency) item.currency = String(additional.currency).trim().toUpperCase();
		if (additional.assigneeId) item.assignee_id = Number(additional.assigneeId);
		const attributes = keyValuesToObject(additional.customAttributes);
		if (Object.keys(attributes).length) item.custom_attributes = attributes;
		try {
			deal = unwrapPayload(
				await zelliaApiRequest.call(this, 'POST', itemsPath, { pipeline_item: item }),
			);
		} catch (error) {
			// Zellia may open the deal itself (pipeline routing) between the check and the POST.
			// Its error text depends on the account language, so check the deals instead of the text.
			const opened = await findOpen();
			// zelliaApiRequest already wraps errors; re-wrapping returns the same instance
			if (!opened) throw new NodeApiError(this.getNode(), error as JsonObject);
			if (onOpenDeal === 'error') throw refuse(opened);
			deal = opened;
			alreadyExisted = true;
		}
	}

	if (conversationId > 0) {
		await zelliaApiRequest.call(this, 'POST', `${itemsPath}/${deal.id}/link_conversation`, {
			conversation_id: conversationId,
		});
	}
	return { ...deal, alreadyExisted };
}

async function findForContact(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const findBy = this.getNodeParameter('findBy', i) as string;
	const filters = this.getNodeParameter('contactFilters', i, {}) as IDataObject;
	const qs: IDataObject = {};
	let contactId: number;

	if (findBy === 'conversation') {
		const conversationId = this.getNodeParameter('conversationId', i) as number;
		contactId = await contactOfConversation.call(this, conversationId, i);
		if (filters.onlyLinked) qs.conversation_id = conversationId;
	} else {
		contactId = this.getNodeParameter('contactId', i) as number;
	}

	const matches = (deals: IDataObject[]) =>
		deals.filter(
			(deal) =>
				(!filters.pipelineId || Number(deal.pipeline_id) === Number(filters.pipelineId)) &&
				(!filters.status || deal.status === filters.status),
		);
	// Without a status filter an old won or lost deal would end the wait at once
	const deals = await contactDeals.call(
		this,
		contactId,
		qs,
		(list) =>
			filters.status
				? matches(list).length > 0
				: matches(list).some((deal) => deal.status === 'open'),
		Number(filters.waitSeconds ?? 0),
	);
	return matches(deals);
}

async function moveToStage(
	this: IExecuteFunctions,
	pipelineId: number,
	itemsPath: string,
	dealId: number,
	i: number,
): Promise<IDataObject> {
	const stageId = Number(this.getNodeParameter('stageId', i));
	const onlyForward = this.getNodeParameter('onlyForward', i, false) as boolean;
	const deal = await getDeal.call(this, itemsPath, dealId);
	const currentStageId = Number(deal.pipeline_stage_id);
	if (currentStageId === stageId) return { ...deal, result: 'already_in_stage' };

	if (onlyForward) {
		// A closed deal (won or lost) is the end of the board: it is never moved
		if (deal.status === 'won' || deal.status === 'lost')
			return { ...deal, result: 'skipped_closed' };
		const stages = await getStages.call(this, pipelineId);
		// The server's board order: open stages first, then won and lost; then position, then id
		const rank = (id: number) => {
			const stage = stages.find((candidate) => Number(candidate.id) === id);
			const closed = stage && stage.stage_type !== 'open' ? 1 : 0;
			return [closed, Number(stage?.position ?? 0), id];
		};
		const [a, b] = [rank(stageId), rank(currentStageId)];
		const earlier = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
		if (earlier < 0) return { ...deal, result: 'skipped_backward' };
	}
	return { ...(await moveDeal.call(this, itemsPath, dealId, stageId)), result: 'moved' };
}

export async function executeDeal(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getForContact') return await findForContact.call(this, i);

	const pipelineId = Number(this.getNodeParameter('pipelineId', i));
	const itemsPath = `/pipelines/${pipelineId}/items`;

	if (operation === 'create') return await createDeal.call(this, pipelineId, itemsPath, i);

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const qs: IDataObject = {};
		if (filters.stageId) qs.pipeline_stage_id = filters.stageId;
		if (filters.assigneeType && filters.assigneeType !== 'all')
			qs.assignee_type = filters.assigneeType;
		if (filters.q) qs.q = filters.q;
		if (filters.sortBy) qs.sort_by = filters.sortBy;
		if (filters.sortOrder) qs.sort_order = filters.sortOrder;
		return await zelliaApiRequestAllItems.call(
			this,
			itemsPath,
			qs,
			(response) => asArray(response.payload),
			limit,
		);
	}

	if (operation === 'markWon' || operation === 'markLost' || operation === 'registerSale') {
		const target = operation === 'markLost' ? 'lost' : 'won';
		let dealId: number;
		if (this.getNodeParameter('dealLookup', i, 'dealId') === 'conversation') {
			const found = await findDealForConversation.call(this, pipelineId, target, i);
			if (found.output) return found.output;
			dealId = found.dealId;
		} else {
			dealId = this.getNodeParameter('dealId', i) as number;
		}
		if (operation === 'registerSale') return await registerSale.call(this, itemsPath, dealId, i);
		return operation === 'markWon'
			? await markWon.call(this, pipelineId, itemsPath, dealId, i)
			: await markLost.call(this, pipelineId, itemsPath, dealId, i);
	}

	const dealId = this.getNodeParameter('dealId', i) as number;

	switch (operation) {
		case 'get':
			return await getDeal.call(this, itemsPath, dealId);

		case 'update': {
			const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
			const item: IDataObject = {};
			if (fields.value !== undefined) item.value = Number(fields.value);
			if (fields.currency) item.currency = String(fields.currency).trim().toUpperCase();
			if (fields.assigneeId) item.assignee_id = Number(fields.assigneeId);
			const attributes = keyValuesToObject(fields.customAttributes);
			if (Object.keys(attributes).length) {
				item.custom_attributes = await attributesToSave.call(
					this,
					itemsPath,
					dealId,
					attributes,
					fields.replaceAttributes === true,
				);
			}
			if (!Object.keys(item).length) {
				throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
					itemIndex: i,
				});
			}
			return await patchDeal.call(this, itemsPath, dealId, item, i);
		}

		case 'delete':
			await zelliaApiRequest.call(this, 'DELETE', `${itemsPath}/${dealId}`);
			return { id: dealId, deleted: true };

		case 'moveToStage':
			return await moveToStage.call(this, pipelineId, itemsPath, dealId, i);

		case 'linkConversation': {
			const conversationId = this.getNodeParameter('conversationId', i) as number;
			const response = await zelliaApiRequest.call(
				this,
				'POST',
				`${itemsPath}/${dealId}/link_conversation`,
				{ conversation_id: conversationId },
			);
			return { deal_id: dealId, conversations: asArray(response.payload) };
		}

		case 'getConversations': {
			const response = await zelliaApiRequest.call(
				this,
				'GET',
				`${itemsPath}/${dealId}/conversations`,
			);
			return asArray(response.payload);
		}

		case 'getEvents': {
			const response = await zelliaApiRequest.call(this, 'GET', `${itemsPath}/${dealId}/events`);
			return asArray(response.payload);
		}
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
		itemIndex: i,
	});
}
