import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
} from 'n8n-workflow';

// Long enough that it cannot be guessed by trying values against the webhook URL
const MIN_SECRET_LENGTH = 16;

/** The secret only guards incoming calls, so the test checks it locally instead of calling a server. */
export async function testWebhookSecret(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
	const secret = String(credential.data?.secret ?? '');
	if (secret.length < MIN_SECRET_LENGTH) {
		return {
			status: 'Error',
			message: `Use a secret of at least ${MIN_SECRET_LENGTH} characters`,
		};
	}
	return { status: 'OK', message: 'The secret is ready. Use the same value in Zellia.' };
}
