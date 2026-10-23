import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { asArray, zelliaApiRequest } from '../GenericFunctions';

function toOptions(
	items: IDataObject[],
	label: (item: IDataObject) => string,
	value: (item: IDataObject) => string | number = (item) => Number(item.id),
): INodePropertyOptions[] {
	return items
		.map((item) => ({ name: label(item), value: value(item) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

async function list(this: ILoadOptionsFunctions, endpoint: string, qs?: IDataObject) {
	return asArray((await zelliaApiRequest.call(this, 'GET', endpoint, undefined, qs)).payload);
}

async function attributeKeys(
	this: ILoadOptionsFunctions,
	model: string,
): Promise<INodePropertyOptions[]> {
	const definitions = await list.call(this, '/custom_attribute_definitions', {
		attribute_model: model,
	});
	return toOptions(
		definitions.filter((definition) => definition.attribute_model === model),
		(definition) => `${definition.attribute_display_name} (${definition.attribute_key})`,
		(definition) => String(definition.attribute_key),
	);
}

const STAGE_TYPE_LABEL: Record<string, string> = { won: 'won', lost: 'lost' };

export const loadOptions = {
	async getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return toOptions(await list.call(this, '/inboxes'), (inbox) => String(inbox.name));
	},

	async getPipelines(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return toOptions(await list.call(this, '/pipelines'), (pipeline) => String(pipeline.name));
	},

	async getStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const pipelineId = Number(this.getCurrentNodeParameter('pipelineId'));
		if (!Number.isFinite(pipelineId) || pipelineId <= 0) return [];
		const stages = await list.call(this, `/pipelines/${pipelineId}/stages`);
		// Keep the board order instead of sorting by name
		return stages
			.sort((a, b) => Number(a.position) - Number(b.position))
			.map((stage) => {
				const type = STAGE_TYPE_LABEL[String(stage.stage_type)];
				return {
					name: type ? `${stage.name} (${type})` : String(stage.name),
					value: Number(stage.id),
				};
			});
	},

	async getLabels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return toOptions(
			await list.call(this, '/labels'),
			(label) => String(label.title),
			(label) => String(label.title),
		);
	},

	async getAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return toOptions(await list.call(this, '/agents'), (agent) =>
			agent.email ? `${agent.name} (${agent.email})` : String(agent.name),
		);
	},

	async getTeams(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return toOptions(await list.call(this, '/teams'), (team) => String(team.name));
	},

	async getConversationAttributeKeys(this: ILoadOptionsFunctions) {
		return await attributeKeys.call(this, 'conversation_attribute');
	},

	async getContactAttributeKeys(this: ILoadOptionsFunctions) {
		return await attributeKeys.call(this, 'contact_attribute');
	},

	async getDealAttributeKeys(this: ILoadOptionsFunctions) {
		return await attributeKeys.call(this, 'deal_attribute');
	},
};
