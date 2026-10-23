import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { safeEqual } from '../ZelliaTrigger/signature';

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string {
	const value = headers[name.toLowerCase()];
	return String(Array.isArray(value) ? value[0] : (value ?? ''));
}

function toNumber(value: string): number | null {
	const parsed = Number(value);
	return value !== '' && Number.isFinite(parsed) ? parsed : null;
}

/** Reads the context that Captain sends in the X-Chatwoot-* headers of every tool call. */
export function captainContext(headers: Headers): IDataObject {
	return {
		tool: header(headers, 'x-chatwoot-tool-slug') || null,
		account_id: toNumber(header(headers, 'x-chatwoot-account-id')),
		assistant_id: toNumber(header(headers, 'x-chatwoot-assistant-id')),
		conversation_id: toNumber(header(headers, 'x-chatwoot-conversation-display-id')),
		conversation_internal_id: toNumber(header(headers, 'x-chatwoot-conversation-id')),
		contact_id: toNumber(header(headers, 'x-chatwoot-contact-id')),
		contact_phone: header(headers, 'x-chatwoot-contact-phone') || null,
		contact_email: header(headers, 'x-chatwoot-contact-email') || null,
		contact_inbox_id: toNumber(header(headers, 'x-chatwoot-contact-inbox-id')),
		contact_verified: header(headers, 'x-chatwoot-contact-inbox-verified') === 'true',
		channel_type: header(headers, 'x-chatwoot-channel-type') || null,
		source: header(headers, 'x-chatwoot-source') || 'chat',
		idempotency_key: header(headers, 'x-chatwoot-idempotency-key') || null,
	};
}

export class ZelliaToolTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zellia Captain Tool Trigger',
		name: 'zelliaToolTrigger',
		icon: { light: 'file:zellia.svg', dark: 'file:zellia.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{"/" + $parameter["path"]}}',
		description: 'Starts the workflow when a Captain assistant calls a custom tool',
		defaults: {
			name: 'Captain Tool',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				responseMode: '={{$parameter["responseMode"]}}',
				path: '={{$parameter["path"]}}',
				isFullPath: true,
			},
		],
		properties: [
			{
				displayName:
					'In Zellia, open Captain → Tools, create a custom tool and paste the production URL of this node as its endpoint. Use the same HTTP method here and in the tool.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'send-image',
				description: 'The last part of the URL, such as send-image. Must be unique on this n8n.',
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				options: [
					{ name: 'GET', value: 'GET', description: 'Captain sends the parameters in the URL' },
					{ name: 'POST', value: 'POST', description: 'Captain sends the parameters as JSON' },
				],
				default: 'POST',
			},
			{
				displayName: 'Respond',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'When Last Node Finishes',
						value: 'lastNode',
						description: 'The assistant receives the data of the last node that runs',
					},
					{
						name: "Using 'Respond to Webhook' Node",
						value: 'responseNode',
						description: 'You choose the answer with a Respond to Webhook node',
					},
				],
				default: 'lastNode',
				description:
					'Captain reads the answer as the tool result. Keep it short and written for the assistant.',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'API Key Header', value: 'header' },
					{ name: 'Basic Auth', value: 'basic' },
					{ name: 'Bearer Token', value: 'bearer' },
					{ name: 'None', value: 'none' },
				],
				default: 'bearer',
				description: 'Must match the authentication set on the Captain tool',
			},
			{
				displayName: 'Token',
				name: 'authToken',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				displayOptions: { show: { authentication: ['bearer'] } },
				description: 'The same token as in the Captain tool',
			},
			{
				displayName: 'Header Name',
				name: 'authHeaderName',
				type: 'string',
				required: true,
				default: 'X-Api-Key',
				displayOptions: { show: { authentication: ['header'] } },
			},
			{
				displayName: 'Header Value',
				name: 'authHeaderValue',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				displayOptions: { show: { authentication: ['header'] } },
			},
			{
				displayName: 'Username',
				name: 'authUser',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { authentication: ['basic'] } },
			},
			{
				displayName: 'Password',
				name: 'authPassword',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				displayOptions: { show: { authentication: ['basic'] } },
			},
			{
				displayName: 'Only From Account ID',
				name: 'accountId',
				type: 'number',
				default: 0,
				description:
					'Optional. Rejects calls that come from a different Zellia account ID. 0 accepts any account.',
			},
		],
	};

	// Captain calls a fixed URL: there is nothing to register in Zellia
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const headers = req.headers as Headers;

		const reject = (status: number, message: string): IWebhookResponseData => {
			res.status(status).json({ message });
			return { noWebhookResponse: true };
		};

		const authentication = this.getNodeParameter('authentication', 'bearer') as string;
		if (authentication === 'bearer') {
			const expected = this.getNodeParameter('authToken', '') as string;
			const received = header(headers, 'authorization').replace(/^Bearer\s+/i, '');
			if (!expected || !safeEqual(received, expected)) return reject(401, 'Invalid token');
		} else if (authentication === 'header') {
			const name = String(this.getNodeParameter('authHeaderName', '')).trim();
			const expected = this.getNodeParameter('authHeaderValue', '') as string;
			if (!name || !expected || !safeEqual(header(headers, name), expected)) {
				return reject(401, 'Invalid API key');
			}
		} else if (authentication === 'basic') {
			const user = this.getNodeParameter('authUser', '') as string;
			const password = this.getNodeParameter('authPassword', '') as string;
			const received = header(headers, 'authorization').replace(/^Basic\s+/i, '');
			const expected = Buffer.from(`${user}:${password}`).toString('base64');
			if (!user || !password || !safeEqual(received, expected))
				return reject(401, 'Invalid credentials');
		}

		const context = captainContext(headers);
		const allowedAccount = Number(this.getNodeParameter('accountId', 0) || 0);
		if (allowedAccount > 0 && context.account_id !== allowedAccount) {
			return reject(403, 'This tool does not serve this account');
		}

		const method = this.getNodeParameter('httpMethod', 'POST') as string;
		const params = (method === 'GET' ? this.getQueryData() : this.getBodyData()) as IDataObject;
		return { workflowData: [this.helpers.returnJsonArray({ ...context, params: params ?? {} })] };
	}
}
