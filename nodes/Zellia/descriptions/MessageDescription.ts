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
				description: 'Send a file from a binary field or from a public URL',
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
		displayName: 'File Source',
		name: 'fileSource',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Binary Field',
				value: 'binary',
				description: 'A file that an earlier node read or downloaded',
			},
			{
				name: 'URL',
				value: 'url',
				description: 'A public link. The node downloads the file and uploads it to Zellia.',
			},
		],
		default: 'binary',
		displayOptions: { show: { resource: ['message'], operation: ['sendAttachment'] } },
	},
	{
		displayName: 'File URL',
		name: 'fileUrl',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/photo.png',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendAttachment'], fileSource: ['url'] },
		},
		description: 'Public http(s) link to an image, video, audio or document, up to 40 MB',
	},
	{
		displayName: 'File Name',
		name: 'fileName',
		type: 'string',
		default: '',
		placeholder: 'photo.png',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendAttachment'], fileSource: ['url'] },
		},
		description: 'Optional. Defaults to the name in the URL.',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendAttachment'], fileSource: ['binary'] },
		},
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
