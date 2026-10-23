import type { INodeProperties } from 'n8n-workflow';

const R = ['pipeline'];

export const pipelineOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: R } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a pipeline with its stages',
				action: 'Get a pipeline',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many pipelines',
			},
			{
				name: 'Get Stages',
				value: 'getStages',
				action: 'Get the stages of a pipeline',
			},
		],
		default: 'getAll',
	},
];

export const pipelineFields: INodeProperties[] = [
	{
		displayName: 'Pipeline Name or ID',
		name: 'pipelineId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPipelines' },
		required: true,
		default: '',
		displayOptions: { show: { resource: R, operation: ['get', 'getStages'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
];
