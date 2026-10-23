import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { asArray, parseLabels, unwrapPayload, zelliaApiRequest } from '../Zellia/GenericFunctions';
import { safeEqual, verifySignature } from './signature';
import { simplifyEvent } from './simplify';

interface TriggerStaticData {
	webhookId?: number;
	webhookSecret?: string;
}

function findWebhook(response: IDataObject): IDataObject | undefined {
	const payload = unwrapPayload(response);
	const webhook = (payload.webhook as IDataObject | undefined) ?? payload;
	return webhook.id ? webhook : undefined;
}

function listWebhooks(response: IDataObject): IDataObject[] {
	const payload = response.payload as IDataObject | IDataObject[] | undefined;
	if (Array.isArray(payload)) return payload;
	return asArray(payload?.webhooks);
}

/** Inbox of the event, or undefined for events that have none (contacts). */
function inboxOf(body: IDataObject): number | undefined {
	const inbox = body.inbox as IDataObject | undefined;
	const conversation = body.conversation as IDataObject | undefined;
	const candidates = [inbox?.id, body.inbox_id, conversation?.inbox_id];
	for (const candidate of candidates) {
		const id = Number(candidate);
		if (candidate !== undefined && candidate !== null && Number.isFinite(id) && id > 0) return id;
	}
	return undefined;
}

export class ZelliaTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zellia Trigger',
		name: 'zelliaTrigger',
		icon: { light: 'file:zellia.svg', dark: 'file:zellia.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{$parameter["source"] === "automation" ? "Automation rule" : $parameter["events"].join(", ")}}',
		description: 'Starts the workflow when something happens in Zellia',
		defaults: {
			name: 'Zellia Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'zelliaApi',
				required: true,
				displayOptions: { show: { source: ['webhook'] } },
			},
			{
				name: 'zelliaWebhookSecretApi',
				required: true,
				displayOptions: { show: { source: ['automation'], secretSource: ['credential'] } },
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				// Zellia ignores the answer; without this n8n sends the literal text "firstEntryJson"
				responseData: 'noData',
				// An empty path falls back to the node's webhook ID
				path: '={{$parameter["path"]}}',
				isFullPath: true,
			},
		],
		properties: [
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: 'new-lead',
				description:
					'Optional. The last part of the URL, such as new-lead. Must be unique on this n8n. Leave empty to use an automatic ID.',
			},
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Account Webhook',
						value: 'webhook',
						description:
							'Registered in Zellia automatically when the workflow is published. Needs an administrator token.',
					},
					{
						name: 'Automation Rule',
						value: 'automation',
						description:
							'Paste this node URL into a Zellia automation with the action "Send webhook event". Use it for deal stage changes.',
					},
				],
				default: 'webhook',
			},
			{
				displayName:
					'In Zellia, create an automation rule (for example "Deal stage changed"), add the action "Send webhook event" and paste the production URL of this node. Then add ?token= and the secret token below to the end of the URL.',
				name: 'automationNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { source: ['automation'] } },
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				displayOptions: { show: { source: ['webhook'] } },
				options: [
					{ name: 'Contact Created', value: 'contact_created' },
					{ name: 'Contact Updated', value: 'contact_updated' },
					{ name: 'Conversation Created', value: 'conversation_created' },
					{ name: 'Conversation Status Changed', value: 'conversation_status_changed' },
					{ name: 'Conversation Typing Off', value: 'conversation_typing_off' },
					{ name: 'Conversation Typing On', value: 'conversation_typing_on' },
					{ name: 'Conversation Updated', value: 'conversation_updated' },
					{ name: 'Inbox Created', value: 'inbox_created' },
					{ name: 'Inbox Updated', value: 'inbox_updated' },
					{ name: 'Message Created', value: 'message_created' },
					{ name: 'Message Updated', value: 'message_updated' },
					{ name: 'Web Widget Opened', value: 'webwidget_triggered' },
				],
				default: ['message_created'],
			},
			{
				displayName: 'Inbox Name or ID',
				name: 'inboxId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getInboxes' },
				default: '',
				displayOptions: { show: { source: ['webhook'] } },
				description:
					'Only events of this channel. Contact events have no channel and always pass. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Store the Token In',
				name: 'secretSource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Credential (Recommended)',
						value: 'credential',
						description: 'Encrypted, and kept when you edit the node',
					},
					{
						name: 'Node Parameter',
						value: 'parameter',
						description: 'Stored in the workflow without encryption',
					},
				],
				default: 'parameter',
				displayOptions: { show: { source: ['automation'] } },
			},
			{
				displayName: 'Secret Token',
				name: 'automationToken',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				displayOptions: { show: { source: ['automation'], secretSource: ['parameter'] } },
				description:
					'Long random value. Add ?token= and this value to the URL in the Zellia rule. Automation rules do not sign their requests, so requests without the right token are rejected.',
			},
			{
				displayName: 'Message Filters',
				name: 'messageFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				description: 'Apply to message events only',
				options: [
					{
						displayName: 'Ignore Bot Messages',
						name: 'ignoreBots',
						type: 'boolean',
						default: true,
						description:
							'Whether to skip messages sent by agent bots and Captain, so a bot does not answer itself',
					},
					{
						displayName: 'Include Private Notes',
						name: 'includePrivate',
						type: 'boolean',
						default: false,
						description: 'Whether to also trigger on private notes',
					},
					{
						displayName: 'Message Types',
						name: 'messageTypes',
						type: 'multiOptions',
						options: [
							{ name: 'Incoming (From the Contact)', value: 'incoming' },
							{ name: 'Outgoing (From an Agent or Bot)', value: 'outgoing' },
							{ name: 'Template', value: 'template' },
						],
						default: ['incoming'],
					},
				],
			},
			{
				displayName: 'Required Labels',
				name: 'requiredLabels',
				type: 'string',
				default: '',
				placeholder: 'vip, ventas',
				description:
					'Comma-separated. Only events of conversations that have at least one of these labels.',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description:
					'Whether to return a flat object with the most used fields instead of the raw Zellia payload',
			},
		],
	};

	methods = {
		loadOptions: {
			async getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await zelliaApiRequest.call(this, 'GET', '/inboxes');
				return asArray(response.payload)
					.map((inbox) => ({ name: String(inbox.name), value: Number(inbox.id) }))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				if (this.getNodeParameter('source') === 'automation') return true;
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				const url = this.getNodeWebhookUrl('default');
				const events = [...(this.getNodeParameter('events') as string[])].sort();
				const inboxId = Number(this.getNodeParameter('inboxId', '') || 0);

				const webhooks = listWebhooks(await zelliaApiRequest.call(this, 'GET', '/webhooks'));

				// The path or the n8n URL changed: remove the webhook this node registered before,
				// so Zellia stops sending signed events to an address the node no longer owns
				const previous = webhooks.find((webhook) => Number(webhook.id) === staticData.webhookId);
				if (previous && previous.url !== url) {
					await zelliaApiRequest.call(this, 'DELETE', `/webhooks/${previous.id}`);
					delete staticData.webhookId;
					delete staticData.webhookSecret;
				}

				const existing =
					webhooks.find(
						(webhook) => webhook.url === url && Number(webhook.id) !== Number(previous?.id ?? -1),
					) ?? (previous && previous.url === url ? previous : undefined);
				if (!existing) {
					delete staticData.webhookId;
					delete staticData.webhookSecret;
					return false;
				}
				const sameEvents =
					JSON.stringify([...asArray(existing.subscriptions)].map(String).sort()) ===
					JSON.stringify(events);
				const existingInbox = Number((existing.inbox as IDataObject | undefined)?.id ?? 0);
				let current = existing;
				if (!sameEvents || existingInbox !== inboxId) {
					// Settings changed: update in place, which keeps the webhook ID and its secret
					const updated = findWebhook(
						await zelliaApiRequest.call(this, 'PATCH', `/webhooks/${existing.id}`, {
							webhook: { subscriptions: events, inbox_id: inboxId > 0 ? inboxId : null },
						}),
					);
					current = { ...existing, ...(updated ?? {}) };
				}
				staticData.webhookId = Number(current.id);
				if (current.secret) staticData.webhookSecret = String(current.secret);
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				if (this.getNodeParameter('source') === 'automation') return true;
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				const webhook: IDataObject = {
					url: this.getNodeWebhookUrl('default'),
					name: `n8n · ${this.getWorkflow().name ?? 'workflow'}`.slice(0, 100),
					subscriptions: this.getNodeParameter('events') as string[],
				};
				const inboxId = Number(this.getNodeParameter('inboxId', '') || 0);
				if (inboxId > 0) webhook.inbox_id = inboxId;

				const created = findWebhook(
					await zelliaApiRequest.call(this, 'POST', '/webhooks', { webhook }),
				);
				if (!created) return false;
				staticData.webhookId = Number(created.id);
				if (created.secret) staticData.webhookSecret = String(created.secret);
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				if (staticData.webhookId === undefined) return true;
				const webhooks = listWebhooks(await zelliaApiRequest.call(this, 'GET', '/webhooks'));
				if (webhooks.some((webhook) => Number(webhook.id) === staticData.webhookId)) {
					await zelliaApiRequest.call(this, 'DELETE', `/webhooks/${staticData.webhookId}`);
				}
				delete staticData.webhookId;
				delete staticData.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const body = this.getBodyData();
		const source = this.getNodeParameter('source') as string;

		const reject = (status: number, message: string): IWebhookResponseData => {
			res.status(status).json({ message });
			return { noWebhookResponse: true };
		};

		if (source === 'automation') {
			const token =
				this.getNodeParameter('secretSource', 'parameter') === 'credential'
					? String((await this.getCredentials('zelliaWebhookSecretApi')).secret ?? '')
					: (this.getNodeParameter('automationToken', '') as string);
			const received = String((this.getQueryData() as IDataObject).token ?? '');
			// Fail closed: an empty token must not open the URL to anyone
			if (!token || !safeEqual(received, token)) return reject(401, 'Invalid token');
		} else {
			// Zellia always signs account webhooks, so a missing secret means the registration is broken
			const { webhookSecret } = this.getWorkflowStaticData('node') as TriggerStaticData;
			if (!webhookSecret) return reject(401, 'Webhook secret unknown. Publish the workflow again.');
			const signature = String(req.headers['x-chatwoot-signature'] ?? '');
			const timestamp = String(req.headers['x-chatwoot-timestamp'] ?? '');
			const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
			if (!signature || !raw || !verifySignature(webhookSecret, timestamp, signature, raw)) {
				return reject(401, 'Invalid signature');
			}
			// Zellia ignores inbox_id on account webhooks, so the inbox filter runs here
			const inboxId = Number(this.getNodeParameter('inboxId', '') || 0);
			const eventInbox = inboxOf(body);
			if (inboxId > 0 && eventInbox !== undefined && eventInbox !== inboxId) {
				return { workflowData: [] };
			}
		}

		const event = String(body.event ?? '');
		const isMessage = event === 'message_created' || event === 'message_updated';
		if (isMessage) {
			const filters = this.getNodeParameter('messageFilters', {}) as IDataObject;
			const types = (filters.messageTypes as string[] | undefined) ?? ['incoming'];
			const sender = body.sender as IDataObject | undefined;
			if (types.length && !types.includes(String(body.message_type))) return { workflowData: [] };
			if (body.private === true && !(filters.includePrivate as boolean | undefined)) {
				return { workflowData: [] };
			}
			const fromBot = sender?.type === 'agent_bot' || sender?.type === 'captain_assistant';
			if ((filters.ignoreBots ?? true) && fromBot) return { workflowData: [] };
		}

		const required = parseLabels(this.getNodeParameter('requiredLabels', ''));
		if (required.length) {
			const conversation = (body.conversation as IDataObject | undefined) ?? body;
			const labels = parseLabels(conversation.labels);
			if (!required.some((label) => labels.includes(label))) return { workflowData: [] };
		}

		const simplify = this.getNodeParameter('simplify', true) as boolean;
		const json = simplify ? simplifyEvent(body) : body;
		return { workflowData: [this.helpers.returnJsonArray(json)] };
	}
}
