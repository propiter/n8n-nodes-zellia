import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ZelliaApi implements ICredentialType {
	name = 'zelliaApi';

	displayName = 'Zellia API';

	icon: Icon = { light: 'file:zellia.svg', dark: 'file:zellia.dark.svg' };

	documentationUrl = 'https://github.com/propiter/n8n-nodes-zellia#readme';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://app.zellia.io',
			placeholder: 'https://app.zellia.io',
			description: 'URL of your Zellia instance, without a trailing slash',
			required: true,
		},
		{
			displayName: 'Account ID',
			name: 'accountId',
			type: 'number',
			default: 0,
			description:
				'Number that follows /app/accounts/ in the Zellia URL when you open the dashboard',
			required: true,
		},
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Agent token (Profile Settings → Access Token) or agent bot token (Settings → Bots). Bot tokens can only use some operations.',
			required: true,
		},
		{
			displayName: 'Default Country Code',
			name: 'defaultCountryCode',
			type: 'string',
			default: '',
			placeholder: '57',
			description:
				'Optional. Added to phone numbers written without a country code, such as 300 123 4567. Leave empty to only add the + sign.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				api_access_token: '={{$credentials.accessToken}}',
			},
		},
	};

	// The inbox list is the one endpoint that accepts both agent and bot tokens
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '=/api/v1/accounts/{{$credentials.accountId}}/inboxes',
			method: 'GET',
		},
	};
}
