import type { IDataObject, IExecuteFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	asArray,
	findContact,
	getZelliaCredentials,
	keyValuesToObject,
	normalizePhone,
	parseLabels,
	unwrapPayload,
	zelliaApiRequest,
	zelliaApiRequestAllItems,
} from '../GenericFunctions';
import { buildMessageBody, postMessage } from './message';

/** The parts of a conversation that answer "where is it and who has it". */
export function summarizeStatus(conversation: IDataObject): IDataObject {
	const meta = (conversation.meta as IDataObject | undefined) ?? {};
	const assignee = meta.assignee as IDataObject | undefined;
	const team = meta.team as IDataObject | undefined;
	const isBot = String(meta.assignee_type ?? '') === 'AgentBot';
	const hasAgent = !!assignee?.id && !isBot;
	// A human assignee wins; pending without one means a bot is answering
	const handledBy = hasAgent
		? 'agent'
		: isBot || conversation.status === 'pending'
			? 'bot'
			: 'nobody';
	const waitingSince = Number(conversation.waiting_since);
	return {
		conversation_id: conversation.id,
		status: conversation.status ?? null,
		handled_by: handledBy,
		snoozed_until: conversation.snoozed_until ?? null,
		priority: conversation.priority ?? null,
		assignee_type: assignee?.id ? (isBot ? 'bot' : 'agent') : null,
		assignee_id: assignee?.id ?? null,
		assignee_name: assignee?.name ?? null,
		team_id: team?.id ?? null,
		team_name: team?.name ?? null,
		labels: Array.isArray(conversation.labels) ? conversation.labels : [],
		// Zellia sends 0 when nobody is waiting
		waiting_since: Number.isFinite(waitingSince) && waitingSince > 0 ? waitingSince : null,
	};
}

async function getLabels(this: IExecuteFunctions, conversationId: number): Promise<string[]> {
	const response = await zelliaApiRequest.call(
		this,
		'GET',
		`/conversations/${conversationId}/labels`,
	);
	return parseLabels(response.payload);
}

async function saveLabels(
	this: IExecuteFunctions,
	conversationId: number,
	labels: string[],
): Promise<IDataObject> {
	// Zellia replaces the whole label list on every POST
	const response = await zelliaApiRequest.call(
		this,
		'POST',
		`/conversations/${conversationId}/labels`,
		{ labels },
	);
	return { conversation_id: conversationId, labels: parseLabels(response.payload) };
}

async function getMessages(this: IExecuteFunctions, conversationId: number, i: number) {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
	const includePrivate = this.getNodeParameter('includePrivate', i, true) as boolean;

	let messages: IDataObject[] = [];
	let before: number | undefined;
	// Zellia pages backwards from the newest message, 20 at a time
	for (let page = 0; page < 1000; page++) {
		const qs: IDataObject = {};
		if (before !== undefined) qs.before = before;
		if (!includePrivate) qs.filter_internal_messages = true;
		const response = await zelliaApiRequest.call(
			this,
			'GET',
			`/conversations/${conversationId}/messages`,
			undefined,
			qs,
		);
		const batch = asArray(response.payload);
		if (!batch.length) break;
		messages = [...batch, ...messages];
		if (messages.length >= limit) break;
		const oldestId = Number(batch[0].id);
		if (!Number.isFinite(oldestId) || oldestId === before) break;
		before = oldestId;
	}
	return Number.isFinite(limit) ? messages.slice(-limit) : messages;
}

async function startOutbound(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const inboxId = Number(this.getNodeParameter('inboxId', i));
	const { defaultCountryCode } = await getZelliaCredentials.call(this);
	const phone = normalizePhone(this.getNodeParameter('phone', i) as string, defaultCountryCode);
	if (phone.length < 8) {
		throw new NodeOperationError(this.getNode(), 'The phone number is not valid', {
			itemIndex: i,
			description: 'Use the full number with the country code, for example +573001234567.',
		});
	}
	const messageBody = buildMessageBody.call(this, i);

	let contact = await findContact.call(
		this,
		phone,
		(candidate) => candidate.phone_number === phone,
	);
	const contactCreated = !contact;
	if (!contact) {
		const name = String(this.getNodeParameter('contactName', i, '') ?? '').trim() || phone;
		const created = await zelliaApiRequest.call(this, 'POST', '/contacts', {
			inbox_id: inboxId,
			name,
			phone_number: phone,
		});
		contact = (unwrapPayload(created).contact as IDataObject) ?? unwrapPayload(created);
	}
	const contactId = Number(contact.id);

	let conversation: IDataObject | undefined;
	if (this.getNodeParameter('reuseOpenConversation', i, true) as boolean) {
		const list = await zelliaApiRequest.call(this, 'GET', `/contacts/${contactId}/conversations`);
		conversation = asArray(list.payload).find(
			(candidate) =>
				Number(candidate.inbox_id) === inboxId &&
				['open', 'pending'].includes(String(candidate.status)),
		);
	}
	const conversationCreated = !conversation;
	if (!conversation) {
		conversation = await zelliaApiRequest.call(this, 'POST', '/conversations', {
			inbox_id: inboxId,
			contact_id: contactId,
		});
	}

	const message = await postMessage.call(this, Number(conversation.id), messageBody);
	return { contact, contactCreated, conversation, conversationCreated, message };
}

/** Runs the hand-off steps in order: message, note, labels, team, agent, status. */
async function handOff(this: IExecuteFunctions, conversationId: number, i: number) {
	const continueOnError = this.getNodeParameter('handOffContinueOnError', i, false) as boolean;
	const path = `/conversations/${conversationId}`;
	const result: IDataObject = { conversation_id: conversationId };
	const errors: IDataObject = {};

	const step = async (name: string, run: () => Promise<unknown>) => {
		try {
			result[name] = (await run()) as IDataObject[keyof IDataObject];
		} catch (error) {
			if (!continueOnError) {
				if (error instanceof NodeApiError)
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
			errors[name] = (error as Error).message;
		}
	};

	const message = String(this.getNodeParameter('handOffMessage', i, '') ?? '');
	if (message.trim()) {
		await step(
			'message',
			async () =>
				await postMessage.call(this, conversationId, {
					content: message,
					message_type: 'outgoing',
				}),
		);
	}

	const note = String(this.getNodeParameter('handOffNote', i, '') ?? '');
	if (note.trim()) {
		await step(
			'note',
			async () =>
				await postMessage.call(this, conversationId, {
					content: note,
					message_type: 'outgoing',
					private: true,
				}),
		);
	}

	const labels = parseLabels(this.getNodeParameter('handOffLabels', i, []));
	const labelMode = this.getNodeParameter('handOffLabelMode', i, 'add') as string;
	if (labels.length || labelMode === 'replace') {
		await step('labels', async () => {
			if (labelMode === 'replace')
				return (await saveLabels.call(this, conversationId, labels)).labels;
			const current = await getLabels.call(this, conversationId);
			const next =
				labelMode === 'remove'
					? current.filter((label) => !labels.includes(label))
					: parseLabels([...current, ...labels]);
			return (await saveLabels.call(this, conversationId, next)).labels;
		});
	}

	const teamId = Number(this.getNodeParameter('handOffTeamId', i, '') || 0);
	if (teamId > 0) {
		await step(
			'team',
			async () =>
				await zelliaApiRequest.call(this, 'POST', `${path}/assignments`, { team_id: teamId }),
		);
	}

	const agentId = Number(this.getNodeParameter('handOffAgentId', i, '') || 0);
	if (agentId > 0) {
		await step(
			'assignee',
			async () =>
				await zelliaApiRequest.call(this, 'POST', `${path}/assignments`, { assignee_id: agentId }),
		);
	}

	const status = this.getNodeParameter('handOffStatus', i, 'open') as string;
	if (status !== 'keep') {
		await step(
			'status',
			async () =>
				unwrapPayload(
					await zelliaApiRequest.call(this, 'POST', `${path}/toggle_status`, { status }),
				).current_status,
		);
	}

	if (Object.keys(errors).length) result.errors = errors;
	return result;
}

export async function executeConversation(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'startOutbound') return await startOutbound.call(this, i);

	if (operation === 'create') {
		const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const body: IDataObject = {
			inbox_id: Number(this.getNodeParameter('inboxId', i)),
			contact_id: this.getNodeParameter('contactId', i) as number,
		};
		if (additional.status) body.status = additional.status;
		if (additional.assigneeId) body.assignee_id = Number(additional.assigneeId);
		if (additional.teamId) body.team_id = Number(additional.teamId);
		if (additional.sourceId) body.source_id = additional.sourceId;
		if (additional.message) body.message = { content: additional.message };
		const attributes = keyValuesToObject(additional.customAttributes);
		if (Object.keys(attributes).length) body.custom_attributes = attributes;
		return await zelliaApiRequest.call(this, 'POST', '/conversations', body);
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const qs: IDataObject = { status: filters.status ?? 'open' };
		if (filters.assigneeType) qs.assignee_type = filters.assigneeType;
		if (filters.inboxId) qs.inbox_id = filters.inboxId;
		if (filters.teamId) qs.team_id = filters.teamId;
		if (filters.q) qs.q = filters.q;
		const labels = parseLabels(filters.labels);
		const labelQuery = labels.map((label) => `labels[]=${encodeURIComponent(label)}`).join('&');
		const endpoint = labelQuery ? `/conversations?${labelQuery}` : '/conversations';
		return await zelliaApiRequestAllItems.call(
			this,
			endpoint,
			qs,
			(response) => asArray((response.data as IDataObject | undefined)?.payload),
			limit,
		);
	}

	const conversationId = this.getNodeParameter('conversationId', i) as number;
	const path = `/conversations/${conversationId}`;

	switch (operation) {
		case 'get':
			return await zelliaApiRequest.call(this, 'GET', path);

		case 'getStatus': {
			const conversation = await zelliaApiRequest.call(this, 'GET', path);
			return summarizeStatus(conversation);
		}

		case 'getAttributes': {
			const conversation = await zelliaApiRequest.call(this, 'GET', path);
			return {
				conversation_id: conversationId,
				custom_attributes: (conversation.custom_attributes as IDataObject | undefined) ?? {},
			};
		}

		case 'getLabels':
			return {
				conversation_id: conversationId,
				labels: await getLabels.call(this, conversationId),
			};

		case 'addLabels': {
			const current = await getLabels.call(this, conversationId);
			const wanted = parseLabels(this.getNodeParameter('labels', i));
			return await saveLabels.call(this, conversationId, parseLabels([...current, ...wanted]));
		}

		case 'removeLabels': {
			const current = await getLabels.call(this, conversationId);
			const unwanted = new Set(parseLabels(this.getNodeParameter('labels', i)));
			return await saveLabels.call(
				this,
				conversationId,
				current.filter((label) => !unwanted.has(label)),
			);
		}

		case 'setLabels':
			return await saveLabels.call(
				this,
				conversationId,
				parseLabels(this.getNodeParameter('labels', i)),
			);

		case 'assign': {
			const assignTo = this.getNodeParameter('assignTo', i) as string;
			const bodies: Record<string, () => IDataObject> = {
				agent: () => ({ assignee_id: Number(this.getNodeParameter('agentId', i)) }),
				bot: () => ({
					assignee_id: this.getNodeParameter('agentBotId', i) as number,
					assignee_type: 'AgentBot',
				}),
				unassign: () => ({ assignee_id: 0 }),
				team: () => ({ team_id: Number(this.getNodeParameter('teamId', i)) }),
				unassignTeam: () => ({ team_id: 0 }),
			};
			const response = await zelliaApiRequest.call(
				this,
				'POST',
				`${path}/assignments`,
				bodies[assignTo](),
			);
			const key = assignTo === 'team' || assignTo === 'unassignTeam' ? 'team' : 'assignee';
			const assigned = Object.keys(response).length ? response : null;
			return { conversation_id: conversationId, [key]: assigned };
		}

		case 'setStatus': {
			const status = this.getNodeParameter('status', i) as string;
			const body: IDataObject = { status };
			if (status === 'snoozed') {
				const until = this.getNodeParameter('snoozedUntil', i, '') as string;
				if (until) {
					// Zellia parses snoozed_until as epoch seconds
					const seconds = Math.floor(new Date(until).getTime() / 1000);
					if (!Number.isFinite(seconds)) {
						throw new NodeOperationError(this.getNode(), 'Snoozed Until is not a valid date', {
							itemIndex: i,
						});
					}
					body.snoozed_until = seconds;
				}
			}
			const response = await zelliaApiRequest.call(this, 'POST', `${path}/toggle_status`, body);
			return unwrapPayload(response);
		}

		case 'setPriority': {
			const priority = this.getNodeParameter('priority', i) as string;
			await zelliaApiRequest.call(this, 'PATCH', path, { priority: priority || null });
			return { conversation_id: conversationId, priority: priority || null };
		}

		case 'setAttributes': {
			const attributes = keyValuesToObject(this.getNodeParameter('attributes', i, {}));
			const replace = this.getNodeParameter('replaceAttributes', i, false) as boolean;
			const response = await zelliaApiRequest.call(this, 'POST', `${path}/custom_attributes`, {
				custom_attributes: attributes,
				merge: !replace,
			});
			return { conversation_id: conversationId, ...response };
		}

		case 'getMessages':
			return await getMessages.call(this, conversationId, i);

		case 'handOff':
			return await handOff.call(this, conversationId, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
		itemIndex: i,
	});
}
