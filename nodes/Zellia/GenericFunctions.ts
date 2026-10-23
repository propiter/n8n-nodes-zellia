import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export type ZelliaContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

export const CREDENTIAL_NAME = 'zelliaApi';

const BOT_FORBIDDEN = 'Access to this endpoint is not authorized for bots';

interface ZelliaCredentials {
	baseUrl: string;
	accountId: number;
	defaultCountryCode: string;
}

export async function getZelliaCredentials(this: ZelliaContext): Promise<ZelliaCredentials> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	return {
		baseUrl: String(credentials.baseUrl ?? '').replace(/\/+$/, ''),
		accountId: Number(credentials.accountId),
		defaultCountryCode: String(credentials.defaultCountryCode ?? '').replace(/\D/g, ''),
	};
}

function getProp(value: unknown, key: string): unknown {
	return value !== null && typeof value === 'object' ? (value as IDataObject)[key] : undefined;
}

/** Reads the Zellia error body, whatever layer of the HTTP client wrapped it. */
function extractErrorBody(error: unknown): IDataObject | undefined {
	const candidates = [
		getProp(getProp(getProp(error, 'cause'), 'response'), 'data'),
		getProp(getProp(error, 'response'), 'data'),
		getProp(getProp(error, 'response'), 'body'),
		getProp(getProp(error, 'context'), 'data'),
	];
	for (const candidate of candidates) {
		if (typeof candidate === 'string') {
			try {
				return JSON.parse(candidate) as IDataObject;
			} catch {
				return { error: candidate };
			}
		}
		if (candidate && typeof candidate === 'object') return candidate as IDataObject;
	}
	return undefined;
}

function extractStatus(error: unknown): number | undefined {
	const status =
		getProp(error, 'httpCode') ??
		getProp(getProp(getProp(error, 'cause'), 'response'), 'status') ??
		getProp(getProp(error, 'response'), 'status');
	const parsed = Number(status);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function describeZelliaError(error: unknown): { message?: string; description?: string } {
	const body = extractErrorBody(error);
	const status = extractStatus(error);
	const detail =
		(typeof body?.error === 'string' && body.error) ||
		(typeof body?.message === 'string' && body.message) ||
		(Array.isArray(body?.errors) && body.errors.join(', ')) ||
		undefined;

	if (detail === BOT_FORBIDDEN) {
		return {
			message: 'This operation needs an agent token',
			description:
				'Zellia does not allow agent bot tokens to call this endpoint. Use a credential with the access token of an agent or administrator.',
		};
	}
	if (status === 401 && detail === 'Invalid Access Token') {
		return {
			message: 'Invalid Zellia access token',
			description: 'Check the access token in the Zellia API credential.',
		};
	}
	if (status === 401 && detail === 'You are not authorized to do this action') {
		return {
			message: 'The token owner is not allowed to do this',
			description:
				'The agent behind this token lacks the permission (some operations need an administrator).',
		};
	}
	if (status === 404) {
		return {
			message: 'Not found in Zellia',
			description:
				detail ??
				'Check the IDs. Conversation IDs are the number shown in the Zellia URL, not an internal ID.',
		};
	}
	if (status === 429) {
		return {
			message: 'Zellia received too many requests',
			description:
				'Wait a moment and try again. For loops, add a Wait node or turn on Retry On Fail with a pause.',
		};
	}
	if (status !== undefined && status >= 500) {
		return {
			message: 'Zellia is not available right now',
			description: detail ?? `Zellia answered HTTP ${status}. Try again in a few minutes.`,
		};
	}
	return detail ? { message: detail } : {};
}

export async function zelliaApiRequest(
	this: ZelliaContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject | Buffer,
	qs?: IDataObject,
	extraOptions: Partial<IHttpRequestOptions> = {},
): Promise<IDataObject> {
	const { baseUrl, accountId } = await getZelliaCredentials.call(this);
	const url = endpoint.startsWith('/api/')
		? `${baseUrl}${endpoint}`
		: `${baseUrl}/api/v1/accounts/${accountId}${endpoint}`;

	const options: IHttpRequestOptions = {
		method,
		url,
		json: true,
		...extraOptions,
	};
	if (body !== undefined && method !== 'GET') options.body = body;
	if (qs && Object.keys(qs).length) options.qs = qs;

	try {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			options,
		)) as unknown;
		if (Buffer.isBuffer(response)) return parseTextResponse(response.toString('utf8'));
		if (typeof response === 'string') return parseTextResponse(response);
		if (Array.isArray(response)) return { payload: response as IDataObject[] };
		return (response ?? {}) as IDataObject;
	} catch (error) {
		const { message, description } = describeZelliaError(error);
		// The HTTP helper already wraps errors, and re-wrapping returns that same instance
		const apiError = new NodeApiError(this.getNode(), error as JsonObject, {
			message,
			description,
		});
		if (message) apiError.message = message;
		if (description) apiError.description = description;
		throw apiError;
	}
}

function parseTextResponse(text: string): IDataObject {
	if (!text.trim()) return {};
	try {
		const parsed = JSON.parse(text) as unknown;
		return Array.isArray(parsed) ? { payload: parsed as IDataObject[] } : (parsed as IDataObject);
	} catch {
		return { response: text };
	}
}

/** Fetches page after page until the limit or the end of the list. */
export async function zelliaApiRequestAllItems(
	this: ZelliaContext,
	endpoint: string,
	qs: IDataObject,
	extract: (response: IDataObject) => IDataObject[],
	limit?: number,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let page = 1;
	// Hard stop so a misbehaving endpoint cannot loop forever
	const maxPages = 1000;
	while (page <= maxPages) {
		const response = await zelliaApiRequest.call(this, 'GET', endpoint, undefined, { ...qs, page });
		const items = extract(response);
		results.push(...items);
		if (limit !== undefined && results.length >= limit) return results.slice(0, limit);
		const meta = getProp(response, 'meta');
		const hasMore = getProp(meta, 'has_more');
		if (items.length === 0 || hasMore === false) break;
		const total = Number(getProp(meta, 'total_count') ?? getProp(meta, 'all_count'));
		if (Number.isFinite(total) && total > 0 && results.length >= total) break;
		page++;
	}
	return results;
}

export function asArray(value: unknown): IDataObject[] {
	return Array.isArray(value) ? (value as IDataObject[]) : [];
}

export function unwrapPayload(response: IDataObject): IDataObject {
	const payload = response.payload;
	return payload && typeof payload === 'object' && !Array.isArray(payload)
		? (payload as IDataObject)
		: response;
}

/**
 * Turns a phone into E.164, which is the only format Zellia accepts.
 * "+57 300-123 4567" and "0057 300 123 4567" keep their code. With a default country code,
 * a national number such as "300 123 4567" gets it; without one, only the + is added.
 */
export function normalizePhone(raw: string, defaultCountryCode = ''): string {
	const trimmed = String(raw ?? '').trim();
	let digits = trimmed.replace(/\D/g, '');
	if (!digits) return '';
	if (trimmed.startsWith('+')) return `+${digits}`;
	if (digits.startsWith('00')) return `+${digits.slice(2)}`;
	const code = String(defaultCountryCode ?? '').replace(/\D/g, '');
	// A number that already starts with the code and is long enough to hold one is kept
	if (code && !(digits.startsWith(code) && digits.length >= code.length + 8)) {
		digits = `${code}${digits}`;
	}
	return `+${digits}`;
}

/** Zellia stores label definitions in lowercase, so labels are compared and written in lowercase. */
export function parseLabels(value: unknown): string[] {
	const list = Array.isArray(value) ? value : String(value ?? '').split(',');
	return [
		...new Set(
			list.map((label) => String(label).trim().toLowerCase()).filter((label) => label !== ''),
		),
	];
}

/** Searches contacts page by page until one passes the exact-match check. */
export async function findContact(
	this: ZelliaContext,
	query: string,
	isMatch: (contact: IDataObject) => boolean,
	maxPages = 10,
): Promise<IDataObject | undefined> {
	for (let page = 1; page <= maxPages; page++) {
		const response = await zelliaApiRequest.call(this, 'GET', '/contacts/search', undefined, {
			q: query,
			page,
		});
		const match = asArray(response.payload).find(isMatch);
		if (match) return match;
		if (getProp(response.meta, 'has_more') !== true) return undefined;
	}
	return undefined;
}

export function keyValuesToObject(collection: unknown, groupName = 'values'): IDataObject {
	const entries = asArray(getProp(collection, groupName));
	const result: IDataObject = {};
	for (const entry of entries) {
		const key = String(entry.key ?? '').trim();
		if (key) result[key] = entry.value as IDataObject[keyof IDataObject];
	}
	return result;
}

/** Builds a multipart/form-data body by hand so it works on every n8n version. */
export function buildMultipart(
	fields: Record<string, string>,
	file: { field: string; fileName: string; mimeType: string; data: Buffer },
): { body: Buffer; contentType: string } {
	const boundary = `----n8nZellia${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
	const chunks: Buffer[] = [];
	for (const [name, value] of Object.entries(fields)) {
		chunks.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
			),
		);
	}
	const safeName = file.fileName.replace(/"/g, '');
	chunks.push(
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${safeName}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
		),
		file.data,
		Buffer.from(`\r\n--${boundary}--\r\n`),
	);
	return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
