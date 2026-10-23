import type { INodeProperties } from 'n8n-workflow';

import { customAttributesField } from './SharedFields';

const R = ['deal'];

export const dealOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: R } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a deal for a contact, or return the open one. Needs an agent token.',
				action: 'Create a deal',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Needs an administrator token',
				action: 'Delete a deal',
			},
			{
				name: 'Find for Contact or Conversation',
				value: 'getForContact',
				description: 'Deals of a contact across all pipelines, open deals first',
				action: 'Find deals for a contact or conversation',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a deal',
			},
			{
				name: 'Get Conversations',
				value: 'getConversations',
				description: 'Conversations linked to the deal',
				action: 'Get the conversations of a deal',
			},
			{
				name: 'Get History',
				value: 'getEvents',
				description: 'Stage changes of the deal, newest first',
				action: 'Get the history of a deal',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Deals of a pipeline',
				action: 'Get many deals',
			},
			{
				name: 'Link Conversation',
				value: 'linkConversation',
				description: 'Needs an agent token',
				action: 'Link a conversation to a deal',
			},
			{
				name: 'Mark as Lost',
				value: 'markLost',
				description: 'Move the deal to the lost stage of its pipeline',
				action: 'Mark a deal as lost',
			},
			{
				name: 'Mark as Won',
				value: 'markWon',
				description: 'Set the amount and move the deal to the won stage of its pipeline',
				action: 'Mark a deal as won',
			},
			{
				name: 'Move to Stage',
				value: 'moveToStage',
				action: 'Move a deal to a stage',
			},
			{
				name: 'Register Sale',
				value: 'registerSale',
				description:
					"Zellia's own sale registration: sets the amount and wins the deal in one locked step. Needs an agent token.",
				action: 'Register a sale',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Bot tokens can only change the amount and currency',
				action: 'Update a deal',
			},
		],
		default: 'getForContact',
	},
];

const withPipeline = [
	'create',
	'delete',
	'get',
	'getAll',
	'getConversations',
	'getEvents',
	'linkConversation',
	'markLost',
	'markWon',
	'moveToStage',
	'registerSale',
	'update',
];

const closing = ['markWon', 'markLost', 'registerSale'];
const withDeal = withPipeline.filter(
	(operation) => !['create', 'getAll', ...closing].includes(operation),
);

export const dealFields: INodeProperties[] = [
	{
		displayName: 'Pipeline Name or ID',
		name: 'pipelineId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPipelines' },
		required: true,
		default: '',
		displayOptions: { show: { resource: R, operation: withPipeline } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Deal ID',
		name: 'dealId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: R, operation: withDeal } },
	},
	{
		displayName: 'Find Deal By',
		name: 'dealLookup',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Deal ID', value: 'dealId' },
			{
				name: 'Conversation ID',
				value: 'conversation',
				description:
					'The open deal of the contact of the conversation in this pipeline. The result field says won, already done or no deal.',
			},
		],
		default: 'dealId',
		displayOptions: { show: { resource: R, operation: closing } },
	},
	{
		displayName: 'Deal ID',
		name: 'dealId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: {
			show: { resource: R, operation: closing, dealLookup: ['dealId'] },
		},
	},
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: {
			show: { resource: R, operation: closing, dealLookup: ['conversation'] },
		},
		description: 'Number of the conversation, as shown in the Zellia URL',
	},
	{
		displayName: 'Wait for the Deal (Seconds)',
		name: 'waitSeconds',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 30 },
		default: 0,
		displayOptions: {
			show: { resource: R, operation: closing, dealLookup: ['conversation'] },
		},
		description:
			'Zellia opens the deal of a new conversation a moment after it is created. Set a few seconds to wait for it. 0 does not wait.',
	},

	// Move
	{
		displayName: 'Stage Name or ID',
		name: 'stageId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['pipelineId'] },
		required: true,
		default: '',
		displayOptions: { show: { resource: R, operation: ['moveToStage'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Only Move Forward',
		name: 'onlyForward',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: R, operation: ['moveToStage'] } },
		description:
			'Whether to leave the deal where it is when the stage is earlier on the board. The result field then says skipped_backward.',
	},
	{
		displayName: 'Lost Reason',
		name: 'lostReason',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: R, operation: ['markLost'] } },
		description: 'Optional. Saved in the custom attribute below. Needs an agent token.',
	},
	{
		displayName: 'Reason Attribute Key Name or ID',
		name: 'lostReasonKey',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getDealAttributeKeys' },
		default: '',
		displayOptions: { show: { resource: R, operation: ['markLost'] } },
		description:
			'Deal attribute that stores the reason. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},

	// Won
	{
		displayName: 'Amount',
		name: 'value',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		displayOptions: { show: { resource: R, operation: ['markWon', 'registerSale'] } },
		description:
			'Sale amount. Leave 0 to keep the amount the deal already has; a won deal needs an amount above 0.',
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'string',
		default: '',
		placeholder: 'COP',
		displayOptions: { show: { resource: R, operation: ['markWon'] } },
		description: 'Three-letter code. Leave empty to keep the current one.',
	},

	// Link
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: R, operation: ['linkConversation'] } },
		description: 'Number of the conversation, as shown in the Zellia URL',
	},

	// Create
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: R, operation: ['create'] } },
	},
	{
		displayName: 'If the Contact Has an Open Deal',
		name: 'onOpenDeal',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Return It',
				value: 'returnExisting',
				description: 'Return the open deal without changes',
			},
			{
				name: 'Fail',
				value: 'error',
				description: 'Stop with an error',
			},
		],
		default: 'returnExisting',
		displayOptions: { show: { resource: R, operation: ['create'] } },
		description: 'Zellia allows only one open deal per contact in each pipeline',
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
			{
				displayName: 'Amount',
				name: 'value',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
			},
			{
				displayName: 'Conversation ID',
				name: 'conversationId',
				type: 'number',
				default: 0,
				description: 'Conversation to link to the deal',
			},
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'string',
				default: '',
				placeholder: 'COP',
				description: 'Three-letter code. Defaults to the pipeline currency.',
			},
			customAttributesField('customAttributes', 'getDealAttributeKeys'),
			{
				displayName: 'Stage Name or ID',
				name: 'stageId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['pipelineId'] },
				default: '',
				description:
					'Defaults to the first open stage. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},

	// Update
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: R, operation: ['update'] } },
		options: [
			{
				displayName: 'Agent Name or ID',
				name: 'assigneeId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAgents' },
				default: '',
				description:
					'Needs an agent token. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Amount',
				name: 'value',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
			},
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'string',
				default: '',
				placeholder: 'COP',
			},
			customAttributesField('customAttributes', 'getDealAttributeKeys'),
			{
				displayName: 'Replace All Attributes',
				name: 'replaceAttributes',
				type: 'boolean',
				default: false,
				description:
					'Whether to delete the attributes not listed here. When off, the listed attributes are merged with the current ones.',
			},
		],
	},

	// Find for contact or conversation
	{
		displayName: 'Find By',
		name: 'findBy',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Contact ID', value: 'contact' },
			{
				name: 'Conversation ID',
				value: 'conversation',
				description: 'Deals of the contact who wrote in that conversation',
			},
		],
		default: 'conversation',
		displayOptions: { show: { resource: R, operation: ['getForContact'] } },
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: R, operation: ['getForContact'], findBy: ['contact'] } },
	},
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: {
			show: { resource: R, operation: ['getForContact'], findBy: ['conversation'] },
		},
		description: 'Number of the conversation, as shown in the Zellia URL',
	},
	{
		displayName: 'Filters',
		name: 'contactFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: R, operation: ['getForContact'] } },
		options: [
			{
				displayName: 'Only Deals Linked to the Conversation',
				name: 'onlyLinked',
				type: 'boolean',
				default: false,
				description:
					'Whether to return only the deals linked to the conversation instead of every deal of its contact',
			},
			{
				displayName: 'Pipeline Name or ID',
				name: 'pipelineId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPipelines' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Lost', value: 'lost' },
					{ name: 'Open', value: 'open' },
					{ name: 'Won', value: 'won' },
				],
				default: 'open',
			},
			{
				displayName: 'Wait for a Deal (Seconds)',
				name: 'waitSeconds',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 30 },
				default: 0,
				description:
					'Wait up to this many seconds for a matching deal, for example while Zellia opens the deal of a new conversation',
			},
		],
	},

	// Get many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: R, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: R, operation: ['getAll'], returnAll: [false] } },
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
					{ name: 'Mine', value: 'me' },
					{ name: 'Unassigned', value: 'unassigned' },
				],
				default: 'all',
			},
			{
				displayName: 'Contact Search',
				name: 'q',
				type: 'string',
				default: '',
				description: 'Part of the contact name',
			},
			{
				displayName: 'Sort By',
				name: 'sortBy',
				type: 'options',
				options: [
					{ name: 'Board Position', value: 'position' },
					{ name: 'Created', value: 'created_at' },
					{ name: 'Entered Stage', value: 'entered_stage' },
					{ name: 'Last Activity', value: 'last_activity' },
				],
				default: 'position',
			},
			{
				displayName: 'Sort Order',
				name: 'sortOrder',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
				],
				default: 'desc',
				description: 'Applies to date sorting only',
			},
			{
				displayName: 'Stage Name or ID',
				name: 'stageId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['pipelineId'] },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		],
	},
];
