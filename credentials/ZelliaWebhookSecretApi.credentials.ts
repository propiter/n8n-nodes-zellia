import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

/** A shared secret for incoming calls: automation rule tokens and Captain tool tokens. */
export class ZelliaWebhookSecretApi implements ICredentialType {
	name = 'zelliaWebhookSecretApi';

	displayName = 'Zellia Webhook Secret API';

	icon: Icon = { light: 'file:zellia.svg', dark: 'file:zellia.dark.svg' };

	documentationUrl = 'https://github.com/propiter/n8n-nodes-zellia#readme';

	properties: INodeProperties[] = [
		{
			displayName: 'Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Long random value. Use the same value in Zellia: in ?token= of an automation rule URL, or in the authentication of a Captain tool.',
		},
	];
}
