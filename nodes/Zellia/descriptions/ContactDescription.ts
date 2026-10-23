import type { INodeProperties } from 'n8n-workflow';

import { customAttributesField } from './SharedFields';

const R = ['contact'];

export const contactOperations: INodeProperties[] = [
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
				action: 'Create a contact',
			},
			{
				name: 'Create or Update',
				value: 'upsert',
				description: 'Create a new record, or update the current one if it already exists (upsert)',
				action: 'Create or update a contact',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a contact',
			},
			{
				name: 'Get Conversations',
				value: 'getConversations',
				description: 'The 20 most recent conversations of the contact',
				action: 'Get the conversations of a contact',
			},
			{
				name: 'Search',
				value: 'search',
				description: 'Search by name, email, phone or identifier',
				action: 'Search contacts',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a contact',
			},
		],
		default: 'upsert',
	},
];

function contactDataFields(): INodeProperties[] {
	return [
		{
			displayName: 'Blocked',
			name: 'blocked',
			type: 'boolean',
			default: false,
			description: 'Whether the contact is blocked',
		},
		customAttributesField('customAttributes', 'getContactAttributeKeys'),
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'name@email.com',
			default: '',
		},
		{
			displayName: 'Identifier',
			name: 'identifier',
			type: 'string',
			default: '',
			description: 'Your own unique ID for the contact, such as a customer number',
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Phone Number',
			name: 'phone',
			type: 'string',
			placeholder: '+573001234567',
			default: '',
			description: 'With the country code. Spaces, dashes and brackets are removed.',
		},
	];
}

export const contactFields: INodeProperties[] = [
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'number',
		required: true,
		default: 0,
		displayOptions: { show: { resource: R, operation: ['get', 'getConversations', 'update'] } },
	},

	// Upsert
	{
		displayName: 'Match By',
		name: 'matchBy',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Email', value: 'email' },
			{ name: 'Identifier', value: 'identifier' },
			{ name: 'Phone Number', value: 'phone' },
		],
		default: 'phone',
		displayOptions: { show: { resource: R, operation: ['upsert'] } },
		description: 'Field used to find an existing contact',
	},
	{
		displayName: 'Value to Match',
		name: 'matchValue',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: R, operation: ['upsert'] } },
		description: 'Also saved on the contact when it is created',
	},

	{
		displayName: 'Inbox Name or ID',
		name: 'inboxId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getInboxes' },
		default: '',
		displayOptions: { show: { resource: R, operation: ['create', 'upsert'] } },
		description:
			'Optional. Links a new contact to this channel so you can message it. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Fields',
		name: 'contactData',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: R, operation: ['create', 'update', 'upsert'] } },
		options: contactDataFields(),
	},

	// Search
	{
		displayName: 'Search Text',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: R, operation: ['search'] } },
		description: 'Part of the name, email, phone number or identifier',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: R, operation: ['search'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: R, operation: ['search'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
];
