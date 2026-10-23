import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	asArray,
	keyValuesToObject,
	unwrapPayload,
	zelliaApiRequest,
	zelliaApiRequestAllItems,
} from '../GenericFunctions';

async function findStageByType(
	this: IExecuteFunctions,
	pipelineId: number,
	stageType: 'won' | 'lost',
	i: number,
): Promise<IDataObject> {
	const response = await zelliaApiRequest.call(this, 'GET', `/pipelines/${pipelineId}/stages`);
	const stage = asArray(response.payload).find((candidate) => candidate.stage_type === stageType);
	if (!stage) {
		throw new NodeOperationError(
			this.getNode(),
			`The pipeline has no ${stageType === 'won' ? 'won' : 'lost'} stage`,
			{ itemIndex: i },
		);
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

async function markWon(
	this: IExecuteFunctions,
	pipelineId: number,
	itemsPath: string,
	dealId: number,
	i: number,
): Promise<IDataObject> {
	const deal = await getDeal.call(this, itemsPath, dealId);
	if (deal.status === 'won') return { ...deal, alreadyInStage: true, result: 'already_won' };

	const value = this.getNodeParameter('value', i, 0) as number;
	const currency = String(this.getNodeParameter('currency', i, '') ?? '')
		.trim()
		.toUpperCase();
	const currentValue = Number(deal.value ?? 0);

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
	if (Object.keys(changes).length) {
		await zelliaApiRequest.call(this, 'PATCH', `${itemsPath}/${dealId}`, {
			pipeline_item: changes,
		});
	}
	const wonStage = await findStageByType.call(this, pipelineId, 'won', i);
	return {
		...(await moveDeal.call(this, itemsPath, dealId, Number(wonStage.id))),
		alreadyInStage: false,
		result: 'won',
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
	if (deal.status === 'lost') return { ...deal, alreadyInStage: true, result: 'already_lost' };
	const lostStage = await findStageByType.call(this, pipelineId, 'lost', i);
	return {
		...(await moveDeal.call(this, itemsPath, dealId, Number(lostStage.id))),
		alreadyInStage: false,
		result: 'lost',
	};
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
	const conversation = await zelliaApiRequest.call(this, 'GET', `/conversations/${conversationId}`);
	const sender = (conversation.meta as IDataObject | undefined)?.sender as IDataObject | undefined;
	const contactId = Number(sender?.id);
	if (!Number.isFinite(contactId) || contactId <= 0) {
		throw new NodeOperationError(this.getNode(), 'The conversation has no contact', {
			itemIndex: i,
		});
	}

	const response = await zelliaApiRequest.call(
		this,
		'GET',
		`/contacts/${contactId}/pipeline_items`,
	);
	const deals = asArray(response.payload).filter((deal) => Number(deal.pipeline_id) === pipelineId);

	// Zellia allows one open deal per contact in each pipeline
	const open = deals.find((deal) => deal.status === 'open');
	if (open) return { dealId: Number(open.id) };

	const done = deals.find(
		(deal) =>
			deal.status === target &&
			Number((deal.active_conversation as IDataObject | undefined)?.id) === conversationId,
	);
	if (done) {
		return {
			output: {
				...done,
				alreadyInStage: true,
				result: `already_${target}`,
				conversation_id: conversationId,
			},
		};
	}
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

	const existingList = await zelliaApiRequest.call(
		this,
		'GET',
		`/contacts/${contactId}/pipeline_items`,
	);
	const open = asArray(existingList.payload).find(
		(deal) => Number(deal.pipeline_id) === pipelineId && deal.status === 'open',
	);

	let deal: IDataObject;
	let alreadyExisted = false;
	if (open) {
		if (onOpenDeal === 'error') {
			throw new NodeOperationError(
				this.getNode(),
				`The contact already has an open deal (ID ${open.id}) in this pipeline`,
				{ itemIndex: i },
			);
		}
		deal = open;
		alreadyExisted = true;
	} else {
		const item: IDataObject = { contact_id: contactId };
		if (additional.stageId) item.pipeline_stage_id = Number(additional.stageId);
		if (Number(additional.value) > 0) item.value = Number(additional.value);
		if (additional.currency) item.currency = String(additional.currency).trim().toUpperCase();
		if (additional.assigneeId) item.assignee_id = Number(additional.assigneeId);
		const attributes = keyValuesToObject(additional.customAttributes);
		if (Object.keys(attributes).length) item.custom_attributes = attributes;
		deal = unwrapPayload(
			await zelliaApiRequest.call(this, 'POST', itemsPath, { pipeline_item: item }),
		);
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
		const conversation = await zelliaApiRequest.call(
			this,
			'GET',
			`/conversations/${conversationId}`,
		);
		const sender = (conversation.meta as IDataObject | undefined)?.sender as
			| IDataObject
			| undefined;
		contactId = Number(sender?.id);
		if (!Number.isFinite(contactId) || contactId <= 0) {
			throw new NodeOperationError(this.getNode(), 'The conversation has no contact', {
				itemIndex: i,
			});
		}
		if (filters.onlyLinked) qs.conversation_id = conversationId;
	} else {
		contactId = this.getNodeParameter('contactId', i) as number;
	}

	const response = await zelliaApiRequest.call(
		this,
		'GET',
		`/contacts/${contactId}/pipeline_items`,
		undefined,
		qs,
	);
	return asArray(response.payload).filter(
		(deal) =>
			(!filters.pipelineId || Number(deal.pipeline_id) === Number(filters.pipelineId)) &&
			(!filters.status || deal.status === filters.status),
	);
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

	if (operation === 'markWon' || operation === 'markLost') {
		const target = operation === 'markWon' ? 'won' : 'lost';
		let dealId: number;
		if (this.getNodeParameter('dealLookup', i, 'dealId') === 'conversation') {
			const found = await findDealForConversation.call(this, pipelineId, target, i);
			if (found.output) return found.output;
			dealId = found.dealId;
		} else {
			dealId = this.getNodeParameter('dealId', i) as number;
		}
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
			if (Object.keys(attributes).length) item.custom_attributes = attributes;
			if (!Object.keys(item).length) {
				throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
					itemIndex: i,
				});
			}
			return unwrapPayload(
				await zelliaApiRequest.call(this, 'PATCH', `${itemsPath}/${dealId}`, {
					pipeline_item: item,
				}),
			);
		}

		case 'delete':
			await zelliaApiRequest.call(this, 'DELETE', `${itemsPath}/${dealId}`);
			return { id: dealId, deleted: true };

		case 'moveToStage':
			return await moveDeal.call(
				this,
				itemsPath,
				dealId,
				Number(this.getNodeParameter('stageId', i)),
			);

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
