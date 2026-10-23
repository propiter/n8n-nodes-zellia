import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

type Show = NonNullable<IDisplayOptions['show']>;

function withShow(show: Show, extra: Show = {}): IDisplayOptions {
	return { show: { ...show, ...extra } };
}

/** Custom attribute key/value pairs, with the keys loaded from the account definitions. */
export function customAttributesField(
	name: string,
	loadOptionsMethod: string,
	show?: Show,
): INodeProperties {
	return {
		displayName: 'Custom Attributes',
		name,
		type: 'fixedCollection',
		placeholder: 'Add Attribute',
		typeOptions: { multipleValues: true },
		default: {},
		...(show ? { displayOptions: { show } } : {}),
		options: [
			{
				displayName: 'Attribute',
				name: 'values',
				values: [
					{
						displayName: 'Key Name or ID',
						name: 'key',
						type: 'options',
						typeOptions: { loadOptionsMethod },
						default: '',
						description:
							'Attribute to set. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	};
}

/** Fields that describe one outgoing message. Shared by Message → Send and Conversation → Start Outbound. */
export function messageContentFields(show: Show): INodeProperties[] {
	return [
		{
			displayName: 'Message Type',
			name: 'messageKind',
			type: 'options',
			noDataExpression: true,
			displayOptions: withShow(show),
			options: [
				{
					name: 'Buttons',
					value: 'buttons',
					description: 'A question with buttons the contact can tap',
				},
				{
					name: 'Cards',
					value: 'cards',
					description: 'Cards with an image, a title and a button',
				},
				{
					name: 'Private Note',
					value: 'note',
					description: 'Internal note only agents can see',
				},
				{ name: 'Text', value: 'text', description: 'Plain text message' },
				{
					name: 'WhatsApp Template',
					value: 'template',
					description: 'Approved WhatsApp template, required outside the 24-hour window',
				},
			],
			default: 'text',
		},
		{
			displayName: 'Content',
			name: 'content',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			displayOptions: withShow(show, { messageKind: ['text', 'note', 'buttons', 'cards'] }),
			description: 'Text of the message. For buttons, the question shown above them.',
		},
		{
			displayName: 'Buttons',
			name: 'buttons',
			type: 'fixedCollection',
			placeholder: 'Add Button',
			typeOptions: { multipleValues: true },
			default: {},
			displayOptions: withShow(show, { messageKind: ['buttons'] }),
			options: [
				{
					displayName: 'Button',
					name: 'values',
					values: [
						{
							displayName: 'Title',
							name: 'title',
							type: 'string',
							default: '',
							description: 'Text on the button',
						},
						{
							displayName: 'Value',
							name: 'value',
							type: 'string',
							default: '',
							description: 'Value Zellia records when the contact taps it. Defaults to the title.',
						},
					],
				},
			],
		},
		{
			displayName: 'Cards',
			name: 'cards',
			type: 'fixedCollection',
			placeholder: 'Add Card',
			typeOptions: { multipleValues: true },
			default: {},
			displayOptions: withShow(show, { messageKind: ['cards'] }),
			options: [
				{
					displayName: 'Card',
					name: 'values',
					values: [
						{
							displayName: 'Button Text',
							name: 'buttonText',
							type: 'string',
							default: '',
						},
						{
							displayName: 'Button Type',
							name: 'buttonType',
							type: 'options',
							options: [
								{ name: 'Open Link', value: 'link' },
								{ name: 'Send Reply', value: 'postback' },
							],
							default: 'link',
						},
						{
							displayName: 'Button Value',
							name: 'buttonValue',
							type: 'string',
							default: '',
							description: 'URL to open, or the reply to send back',
						},
						{
							displayName: 'Description',
							name: 'description',
							type: 'string',
							default: '',
						},
						{
							displayName: 'Image URL',
							name: 'mediaUrl',
							type: 'string',
							default: '',
						},
						{
							displayName: 'Title',
							name: 'title',
							type: 'string',
							default: '',
						},
					],
				},
			],
		},
		{
			displayName: 'Template Name',
			name: 'templateName',
			type: 'string',
			default: '',
			required: true,
			displayOptions: withShow(show, { messageKind: ['template'] }),
			description: 'Name of the approved template in WhatsApp Manager',
		},
		{
			displayName: 'Language',
			name: 'templateLanguage',
			type: 'string',
			default: 'es',
			displayOptions: withShow(show, { messageKind: ['template'] }),
			description: 'Template language code, such as es or es_CO',
		},
		{
			displayName: 'Category',
			name: 'templateCategory',
			type: 'options',
			options: [
				{ name: 'Authentication', value: 'AUTHENTICATION' },
				{ name: 'Marketing', value: 'MARKETING' },
				{ name: 'Utility', value: 'UTILITY' },
			],
			default: 'UTILITY',
			displayOptions: withShow(show, { messageKind: ['template'] }),
		},
		{
			displayName: 'Variable Format',
			name: 'templateParamsFormat',
			type: 'options',
			noDataExpression: true,
			options: [
				{
					name: 'Numbered ({{1}}, {{2}}…)',
					value: 'positional',
					description: 'Template body uses numbered variables',
				},
				{
					name: 'Named',
					value: 'named',
					description: 'Template uses named variables',
				},
			],
			default: 'positional',
			displayOptions: withShow(show, { messageKind: ['template'] }),
		},
		{
			displayName: 'Variables',
			name: 'templatePositional',
			type: 'fixedCollection',
			placeholder: 'Add Variable',
			typeOptions: { multipleValues: true, sortable: true },
			default: {},
			displayOptions: withShow(show, {
				messageKind: ['template'],
				templateParamsFormat: ['positional'],
			}),
			description: 'Values for {{1}}, {{2}}… in order',
			options: [
				{
					displayName: 'Variable',
					name: 'values',
					values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }],
				},
			],
		},
		{
			displayName: 'Variables',
			name: 'templateNamed',
			type: 'fixedCollection',
			placeholder: 'Add Variable',
			typeOptions: { multipleValues: true },
			default: {},
			displayOptions: withShow(show, {
				messageKind: ['template'],
				templateParamsFormat: ['named'],
			}),
			options: [
				{
					displayName: 'Variable',
					name: 'values',
					values: [
						{ displayName: 'Name', name: 'key', type: 'string', default: '' },
						{ displayName: 'Value', name: 'value', type: 'string', default: '' },
					],
				},
			],
		},
		{
			displayName: 'Text Shown in Zellia',
			name: 'templateContent',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			displayOptions: withShow(show, { messageKind: ['template'] }),
			description: 'Optional. The rendered text agents see in the conversation.',
		},
		{
			displayName: 'Message Options',
			name: 'messageOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: withShow(show),
			options: [
				{
					displayName: 'Reply To Message ID',
					name: 'replyToMessageId',
					type: 'number',
					default: 0,
					description: 'ID of a message in the conversation to quote',
				},
				{
					displayName: 'Send As Bot ID',
					name: 'senderBotId',
					type: 'number',
					default: 0,
					description: 'ID of an agent bot of this account to show as the sender',
				},
			],
		},
	];
}
