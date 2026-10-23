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
		credentials: [
			{
				name: 'zelliaWebhookSecretApi',
				required: true,
				displayOptions: {
					show: { authentication: ['bearer', 'header'], secretSource: ['credential'] },
				},
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				// Respond to Webhook only accepts built-in triggers, so the answer is either the
				// last node or a fixed text sent at once
				responseMode:
					'={{$parameter["responseMode"] === "onReceived" ? "onReceived" : "lastNode"}}',
				responseData:
					'={{$parameter["responseMode"] === "onReceived" ? ($parameter["immediateAnswer"] || "noData") : "firstEntryJson"}}',
				path: '={{$parameter["path"]}}',
				isFullPath: true,
			},
		],
		properties: [
			{
				displayName:
					'In Zellia, open Captain → Tools, create a custom tool and paste the production URL of this node as its endpoint. Captain sends parameters only if the tool defines them: in a request template for POST, or as {{name}} placeholders in the URL for GET. The data of the last node is the answer Captain reads.',
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
					{
						name: 'GET',
						value: 'GET',
						description: 'Parameters come from the {{name}} placeholders in the tool URL',
					},
					{
						name: 'POST',
						value: 'POST',
						description: 'Parameters come from the JSON request template of the tool',
					},
				],
				default: 'POST',
			},
			{
				displayName: 'Respond',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'When the Workflow Finishes',
						value: 'lastNode',
						description: 'Captain reads the data of the last node. It waits up to 20 seconds.',
					},
					{
						name: 'Immediately, With a Fixed Answer',
						value: 'onReceived',
						description:
							'For long jobs: Captain gets the text below at once and the workflow keeps running',
					},
				],
				default: 'lastNode',
			},
			{
				displayName: 'Immediate Answer',
				name: 'immediateAnswer',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				placeholder: 'INTERNAL: request received, the result will arrive in the conversation.',
				displayOptions: { show: { responseMode: ['onReceived'] } },
				description:
					'Text Captain receives as the tool result. Write it for the assistant, not for the contact.',
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
				displayName: 'Store the Secret In',
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
				displayOptions: { show: { authentication: ['bearer', 'header'] } },
			},
			{
				displayName: 'Token',
				name: 'authToken',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				displayOptions: { show: { authentication: ['bearer'], secretSource: ['parameter'] } },
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
				displayOptions: { show: { authentication: ['header'], secretSource: ['parameter'] } },
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
		const fromCredential = this.getNodeParameter('secretSource', 'parameter') === 'credential';
		const storedSecret = async (parameter: string) =>
			fromCredential
				? String((await this.getCredentials('zelliaWebhookSecretApi')).secret ?? '')
				: (this.getNodeParameter(parameter, '') as string);
		if (authentication === 'bearer') {
			const expected = await storedSecret('authToken');
			const received = header(headers, 'authorization').replace(/^Bearer\s+/i, '');
			if (!expected || !safeEqual(received, expected)) return reject(401, 'Invalid token');
		} else if (authentication === 'header') {
			const name = String(this.getNodeParameter('authHeaderName', '')).trim();
			const expected = await storedSecret('authHeaderValue');
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
