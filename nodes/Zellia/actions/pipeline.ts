import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { asArray, unwrapPayload, zelliaApiRequest } from '../GenericFunctions';

export async function executePipeline(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getAll') {
		return asArray((await zelliaApiRequest.call(this, 'GET', '/pipelines')).payload);
	}

	const pipelineId = Number(this.getNodeParameter('pipelineId', i));

	if (operation === 'get') {
		return unwrapPayload(await zelliaApiRequest.call(this, 'GET', `/pipelines/${pipelineId}`));
	}
	if (operation === 'getStages') {
		return asArray(
			(await zelliaApiRequest.call(this, 'GET', `/pipelines/${pipelineId}/stages`)).payload,
		);
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
		itemIndex: i,
	});
}
