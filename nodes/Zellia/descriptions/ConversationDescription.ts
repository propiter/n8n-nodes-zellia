import type { INodeProperties } from 'n8n-workflow';

import { customAttributesField, messageContentFields } from './SharedFields';

const R = ['conversation'];

export const conversationOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: R } },
		options: [
			{
				name: 'Add Labels',
				value: 'addLabels',
				description: 'Add labels and keep the ones it already has',
				action: 'Add labels to a conversation',
			},
			{
				name: 'Assign',
				value: 'assign',
				description: 'Assign an agent or a team, or remove the agent',
				action: 'Assign a conversation',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a conversation for an existing contact',
				action: 'Create a conversation',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a conversation',
			},
			{
				name: 'Get Labels',
				value: 'getLabels',
				action: 'Get the labels of a conversation',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List conversations with filters. Needs an agent token.',
				action: 'Get many conversations',
			},
			{
				name: 'Get Messages',
				value: 'getMessages',
				description: 'List the messages of a conversation. Needs an agent token.',
				action: 'Get the messages of a conversation',
			},
			{
				name: 'Remove Labels',
				value: 'removeLabels',
				description: 'Remove labels and keep the others',
				action: 'Remove labels from a conversation',
			},
			{
				name: 'Replace Labels',
				value: 'setLabels',
				description: 'Replace all labels with the ones given',
				action: 'Replace the labels of a conversation',
			},
			{
				name: 'Set Custom Attributes',
				value: 'setAttributes',
				action: 'Set custom attributes of a conversation',
			},
			{
				name: 'Set Priority',
				value: 'setPriority',
				action: 'Set the priority of a conversation',
			},
			{
				name: 'Set Status',
				value: 'setStatus',
				description: 'Open, resolve, set pending or snooze',
				action: 'Set the status of a conversation',
			},
			{
				name: 'Start Outbound',
				value: 'startOutbound',
				description:
					'Find or create the contact by phone, open a conversation and send the first message. Needs an agent token.',
				action: 'Start an outbound conversation',
			},
		],
		default: 'get',
	},
];

const withId = [
	'addLabels',
	'assign',
	'get',
	'getLabels',
	'getMessages',
	'removeLabels',
	'setAttributes',
	'setLabels',
	'setPriority',
	'setStatus',
];

export const conversationFields: INodeProperties[] = [
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: R, operation: withId } },
		description: 'Number of the conversation, as shown in the Zellia URL',
	},

	// Labels
	{
		displayName: 'Label Names or IDs',
		name: 'labels',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getLabels' },
		required: true,
		default: [],
		displayOptions: {
			show: { resource: R, operation: ['addLabels', 'removeLabels', 'setLabels'] },
		},
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},

	// Assign
	{
		displayName: 'Assign To',
		name: 'assignTo',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Agent', value: 'agent' },
			{ name: 'Agent Bot', value: 'bot' },
			{ name: 'No Agent', value: 'unassign', description: 'Remove the assigned agent' },
			{ name: 'No Team', value: 'unassignTeam', description: 'Remove the assigned team' },
			{ name: 'Team', value: 'team' },
		],
		default: 'agent',
		displayOptions: { show: { resource: R, operation: ['assign'] } },
	},
	{
		displayName: 'Agent Name or ID',
		name: 'agentId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getAgents' },
		required: true,
		default: '',
		displayOptions: { show: { resource: R, operation: ['assign'], assignTo: ['agent'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Agent Bot ID',
		name: 'agentBotId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: R, operation: ['assign'], assignTo: ['bot'] } },
		description: 'The conversation becomes pending while the bot handles it',
	},
	{
		displayName: 'Team Name or ID',
		name: 'teamId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTeams' },
		required: true,
		default: '',
		displayOptions: { show: { resource: R, operation: ['assign'], assignTo: ['team'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},

	// Status
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		options: [
			{ name: 'Open', value: 'open' },
			{ name: 'Pending', value: 'pending' },
			{ name: 'Resolved', value: 'resolved' },
			{ name: 'Snoozed', value: 'snoozed' },
		],
		default: 'resolved',
		displayOptions: { show: { resource: R, operation: ['setStatus'] } },
	},
	{
		displayName: 'Snoozed Until',
		name: 'snoozedUntil',
		type: 'dateTime',
		default: '',
		displayOptions: { show: { resource: R, operation: ['setStatus'], status: ['snoozed'] } },
		description: 'Leave empty to snooze until the next reply',
	},

	// Priority
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'options',
		options: [
			{ name: 'High', value: 'high' },
			{ name: 'Low', value: 'low' },
			{ name: 'Medium', value: 'medium' },
			{ name: 'None', value: '' },
			{ name: 'Urgent', value: 'urgent' },
		],
		default: 'medium',
		displayOptions: { show: { resource: R, operation: ['setPriority'] } },
	},

	// Custom attributes
	customAttributesField('attributes', 'getConversationAttributeKeys', {
		resource: R,
		operation: ['setAttributes'],
	}),
	{
		displayName: 'Replace All Attributes',
		name: 'replaceAttributes',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: R, operation: ['setAttributes'] } },
		description:
			'Whether to delete the attributes not listed here. When off, only the listed attributes change.',
	},

	// Create
	{
		displayName: 'Inbox Name or ID',
		name: 'inboxId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getInboxes' },
		required: true,
		default: '',
		displayOptions: { show: { resource: R, operation: ['create', 'startOutbound'] } },
		description:
			'Channel to use. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: R, operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: R, operation: ['create'] } },
		options: [
			{
				displayName: 'Agent Name or ID',
				name: 'assigneeId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAgents' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			customAttributesField('customAttributes', 'getConversationAttributeKeys'),
			{
				displayName: 'First Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Text message to send when the conversation opens',
			},
			{
				displayName: 'Source ID',
				name: 'sourceId',
				type: 'string',
				default: '',
				description: 'Contact identifier in the channel. Zellia fills it in when empty.',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Open', value: 'open' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Resolved', value: 'resolved' },
					{ name: 'Snoozed', value: 'snoozed' },
				],
				default: 'open',
			},
			{
				displayName: 'Team Name or ID',
				name: 'teamId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTeams' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		],
	},

	// Start outbound
	{
		displayName: 'Phone Number',
		name: 'phone',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+573001234567',
		displayOptions: { show: { resource: R, operation: ['startOutbound'] } },
		description: 'With the country code. Spaces, dashes and brackets are removed.',
	},
	{
		displayName: 'Contact Name',
		name: 'contactName',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: R, operation: ['startOutbound'] } },
		description: 'Used only when the contact does not exist yet',
	},
	{
		displayName: 'Reuse Open Conversation',
		name: 'reuseOpenConversation',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: R, operation: ['startOutbound'] } },
		description:
			'Whether to post into an open or pending conversation of the contact in this inbox instead of creating a new one',
	},
	...messageContentFields({ resource: R, operation: ['startOutbound'] }),

	// Get many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: R, operation: ['getAll', 'getMessages'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: {
			show: { resource: R, operation: ['getAll', 'getMessages'], returnAll: [false] },
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: R, operation: ['getAll'] } },
		options: [
			{
				displayName: 'Assignee',
				name: 'assigneeType',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Assigned', value: 'assigned' },
					{ name: 'Mine', value: 'me' },
					{ name: 'Unassigned', value: 'unassigned' },
				],
				default: 'all',
			},
			{
				displayName: 'Inbox Name or ID',
				name: 'inboxId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getInboxes' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Label Names or IDs',
				name: 'labels',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getLabels' },
				default: [],
				description:
					'Conversations with any of these labels. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Search Text',
				name: 'q',
				type: 'string',
				default: '',
				description: 'Text contained in the messages',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Open', value: 'open' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Resolved', value: 'resolved' },
					{ name: 'Snoozed', value: 'snoozed' },
				],
				default: 'open',
			},
			{
				displayName: 'Team Name or ID',
				name: 'teamId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTeams' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		],
	},
	{
		displayName: 'Include Private Notes',
		name: 'includePrivate',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: R, operation: ['getMessages'] } },
		description: 'Whether to include private notes and activity messages',
	},
];
