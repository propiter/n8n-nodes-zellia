import type { IDataObject } from 'n8n-workflow';

function obj(value: unknown): IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: {};
}

function num(value: unknown): number | null {
	const parsed = Number(value);
	return value === null || value === undefined || value === '' || !Number.isFinite(parsed)
		? null
		: parsed;
}

function conversationFields(conversation: IDataObject): IDataObject {
	const meta = obj(conversation.meta);
	const contact = obj(meta.sender);
	const assignee = obj(meta.assignee);
	const team = obj(meta.team);
	return {
		conversation_id: num(conversation.id),
		conversation_status: conversation.status ?? null,
		inbox_id: num(conversation.inbox_id),
		channel: conversation.channel ?? null,
		labels: Array.isArray(conversation.labels) ? conversation.labels : [],
		conversation_attributes: obj(conversation.custom_attributes),
		contact_id: num(contact.id),
		contact_name: contact.name ?? null,
		contact_phone: contact.phone_number ?? null,
		contact_email: contact.email ?? null,
		contact_attributes: obj(contact.custom_attributes),
		assignee_id: num(assignee.id),
		assignee_name: assignee.name ?? null,
		team_id: num(team.id),
		team_name: team.name ?? null,
	};
}

function dealFields(body: IDataObject): IDataObject {
	const deal = obj(body.deal);
	const pipeline = obj(deal.pipeline);
	const stage = obj(deal.stage);
	const fromStage = obj(body.from_stage);
	const contact = obj(deal.contact);
	const assignee = obj(deal.assignee);
	const performedBy = obj(body.performed_by);
	return {
		event: body.event,
		account_id: num(obj(body.account).id),
		deal_id: num(deal.id),
		deal_status: deal.status ?? null,
		value: num(deal.value),
		currency: deal.currency ?? null,
		pipeline_id: num(pipeline.id),
		pipeline_name: pipeline.name ?? null,
		stage_id: num(stage.id),
		stage_name: stage.name ?? null,
		stage_type: stage.stage_type ?? null,
		from_stage_id: num(fromStage.id),
		from_stage_name: fromStage.name ?? null,
		from_stage_type: fromStage.stage_type ?? null,
		conversation_id: num(body.conversation_id ?? deal.conversation_display_id),
		contact_id: num(contact.id),
		contact_name: contact.name ?? null,
		contact_phone: contact.phone_number ?? null,
		contact_email: contact.email ?? null,
		assignee_id: num(assignee.id),
		assignee_name: assignee.name ?? null,
		deal_attributes: obj(deal.custom_attributes),
		performed_by_type: performedBy.type ?? null,
		performed_by_id: num(performedBy.id),
		automation_rule: obj(body.automation_rule),
	};
}

/** Flattens a Zellia webhook payload into the fields most workflows read. */
export function simplifyEvent(body: IDataObject): IDataObject {
	const event = String(body.event ?? '');
	const account = obj(body.account);

	if (body.deal) return dealFields(body);

	if (event === 'message_created' || event === 'message_updated') {
		const sender = obj(body.sender);
		const attachments = Array.isArray(body.attachments) ? (body.attachments as IDataObject[]) : [];
		return {
			event,
			account_id: num(account.id),
			message_id: num(body.id),
			text: body.content ?? '',
			message_type: body.message_type ?? null,
			content_type: body.content_type ?? null,
			private: body.private === true,
			sender_type: sender.type ?? null,
			sender_id: num(sender.id),
			sender_name: sender.name ?? null,
			created_at: body.created_at ?? null,
			attachments: attachments.map((attachment) => ({
				type: attachment.file_type ?? null,
				url: attachment.data_url ?? null,
				name: attachment.file_name ?? null,
			})),
			content_attributes: obj(body.content_attributes),
			...conversationFields(obj(body.conversation)),
		};
	}

	if (event === 'contact_created' || event === 'contact_updated') {
		return {
			event,
			account_id: num(account.id),
			contact_id: num(body.id),
			contact_name: body.name ?? null,
			contact_phone: body.phone_number ?? null,
			contact_email: body.email ?? null,
			identifier: body.identifier ?? null,
			contact_attributes: obj(body.custom_attributes),
			changed_attributes: body.changed_attributes ?? null,
		};
	}

	if (event.startsWith('conversation_') || event.startsWith('automation_event.')) {
		const conversation = event.startsWith('conversation_typing') ? obj(body.conversation) : body;
		// Zellia sends the last chat message of the conversation; keep it so nothing is lost
		const messages = Array.isArray(conversation.messages)
			? (conversation.messages as IDataObject[])
			: [];
		const last = obj(messages[messages.length - 1]);
		return {
			event,
			account_id: num(account.id ?? obj(conversation.account).id),
			...conversationFields(conversation),
			last_message_id: num(last.id),
			text: last.content ?? null,
			last_message_type: last.message_type ?? null,
			last_message_private: last.private === true,
			...(body.changed_attributes ? { changed_attributes: body.changed_attributes } : {}),
		};
	}

	return body;
}
