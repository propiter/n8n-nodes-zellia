import type { INodeProperties } from 'n8n-workflow';

import { messageContentFields } from './SharedFields';

export const messageOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['message'] } },
		options: [
			{
				name: 'Send',
				value: 'send',
				description: 'Send a text, private note, buttons, cards or a WhatsApp template',
				action: 'Send a message',
			},
			{
				name: 'Send Attachment',
				value: 'sendAttachment',
				description: 'Send a file from a binary property',
				action: 'Send an attachment',
			},
		],
		default: 'send',
	},
];

export const messageFields: INodeProperties[] = [
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: ['message'] } },
		description: 'Number of the conversation, as shown in the Zellia URL',
	},
	...messageContentFields({ resource: ['message'], operation: ['send'] }),
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: { show: { resource: ['message'], operation: ['sendAttachment'] } },
		hint: 'The name of the input binary field containing the file to send',
	},
	{
		displayName: 'Caption',
		name: 'caption',
		type: 'string',
		typeOptions: { rows: 2 },
		default: '',
		displayOptions: { show: { resource: ['message'], operation: ['sendAttachment'] } },
	},
	{
		displayName: 'Private Note',
		name: 'private',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['message'], operation: ['sendAttachment'] } },
		description: 'Whether only agents can see the file',
	},
];
