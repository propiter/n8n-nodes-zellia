import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { executeContact } from './actions/contact';
import { executeConversation } from './actions/conversation';
import { executeDeal } from './actions/deal';
import { executeMessage } from './actions/message';
import { executePipeline } from './actions/pipeline';
import { contactFields, contactOperations } from './descriptions/ContactDescription';
import { conversationFields, conversationOperations } from './descriptions/ConversationDescription';
import { dealFields, dealOperations } from './descriptions/DealDescription';
import { messageFields, messageOperations } from './descriptions/MessageDescription';
import { pipelineFields, pipelineOperations } from './descriptions/PipelineDescription';
import { loadOptions } from './methods/loadOptions';

type Executor = (
	this: IExecuteFunctions,
	operation: string,
	i: number,
) => Promise<IDataObject | IDataObject[]>;

const executors: Record<string, Executor> = {
	contact: executeContact,
	conversation: executeConversation,
	deal: executeDeal,
	message: executeMessage,
	pipeline: executePipeline,
};

export class Zellia implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Zellia',
		name: 'zellia',
		icon: { light: 'file:zellia.svg', dark: 'file:zellia.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send messages and manage conversations, contacts and deals in Zellia',
		defaults: {
			name: 'Zellia',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'zelliaApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Contact', value: 'contact' },
					{ name: 'Conversation', value: 'conversation' },
					{ name: 'Deal', value: 'deal' },
					{ name: 'Message', value: 'message' },
					{ name: 'Pipeline', value: 'pipeline' },
				],
				default: 'message',
			},
			...messageOperations,
			...messageFields,
			...conversationOperations,
			...conversationFields,
			...contactOperations,
			...contactFields,
			...dealOperations,
			...dealFields,
			...pipelineOperations,
			...pipelineFields,
		],
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const executor = executors[resource];
				if (!executor) {
					throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`, {
						itemIndex: i,
					});
				}
				const result = await executor.call(this, operation, i);
				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(result),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// Both constructors hand back an already wrapped error unchanged
				if (error instanceof NodeApiError) {
					if (error.context) error.context.itemIndex = i;
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				if (error instanceof NodeOperationError && error.context) error.context.itemIndex = i;
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
