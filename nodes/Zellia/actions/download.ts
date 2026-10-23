import type { IExecuteFunctions, IN8nHttpFullResponse } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// Zellia rejects uploads above MAXIMUM_FILE_UPLOAD_SIZE, 40 MB by default
export const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	pdf: 'application/pdf',
	mp4: 'video/mp4',
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	opus: 'audio/ogg',
};

export interface DownloadedFile {
	data: Buffer;
	fileName: string;
	mimeType: string;
}

function headerValue(headers: IN8nHttpFullResponse['headers'] | undefined, name: string): string {
	const value = headers?.[name] ?? headers?.[name.toLowerCase()];
	return String(Array.isArray(value) ? value[0] : (value ?? ''));
}

/** File name from Content-Disposition, else the last path segment of the URL. */
export function fileNameFrom(url: string, contentDisposition: string): string {
	const fromHeader = contentDisposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
	if (fromHeader) return decodeURIComponent(fromHeader.trim());
	try {
		const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
		if (segment) return decodeURIComponent(segment);
	} catch {
		// Not a parseable URL: fall through to the generic name
	}
	return 'file';
}

export function mimeTypeFrom(contentType: string, fileName: string): string {
	const declared = contentType.split(';')[0].trim().toLowerCase();
	if (declared && declared !== 'application/octet-stream') return declared;
	const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
	return MIME_BY_EXTENSION[extension] ?? (declared || 'application/octet-stream');
}

const MAX_REDIRECTS = 3;

function ipv4Blocked(parts: number[]): boolean {
	const [a, b] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	);
}

/** Parses an IPv6 address into 16 bytes, or returns undefined when it is not valid. */
export function parseIpv6(address: string): number[] | undefined {
	let text = address.toLowerCase();
	const tail: number[] = [];
	const dotted = text.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (dotted) {
		const octets = dotted.slice(2).map(Number);
		if (octets.some((octet) => octet > 255)) return undefined;
		tail.push(...octets);
		text = dotted[1].endsWith('::') ? dotted[1] : dotted[1].slice(0, -1);
	}
	const halves = text.split('::');
	if (halves.length > 2) return undefined;
	const toGroups = (part: string) => (part ? part.split(':') : []);
	const head = toGroups(halves[0]);
	const rest = halves.length === 2 ? toGroups(halves[1]) : [];
	const groupCount = 8 - tail.length / 2;
	const missing = groupCount - head.length - rest.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
	const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
	const bytes: number[] = [];
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
		const value = parseInt(group, 16);
		bytes.push(value >> 8, value & 0xff);
	}
	return [...bytes, ...tail];
}

function startsWith(bytes: number[], prefix: number[]): boolean {
	return prefix.every((value, index) => bytes[index] === value);
}

/**
 * Blocks IPv6 ranges that reach local networks, including the transition formats that
 * carry an IPv4 address inside (IPv4-mapped and compatible, NAT64, 6to4 and Teredo).
 */
function ipv6Blocked(address: string): boolean {
	const bytes = parseIpv6(address);
	if (!bytes) return true;
	const zeros = (count: number) => Array<number>(count).fill(0);
	if (startsWith(bytes, [...zeros(10), 0xff, 0xff])) return ipv4Blocked(bytes.slice(12));
	return (
		startsWith(bytes, zeros(12)) || // ::/96: unspecified, loopback and IPv4-compatible
		startsWith(bytes, [0x00, 0x64, 0xff, 0x9b]) || // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
		startsWith(bytes, [0x01, 0x00, ...zeros(6)]) || // 100::/64 discard
		startsWith(bytes, [0x20, 0x02]) || // 2002::/16 (6to4)
		startsWith(bytes, [0x20, 0x01, 0x00, 0x00]) || // 2001::/32 (Teredo)
		startsWith(bytes, [0x20, 0x01, 0x0d, 0xb8]) || // 2001:db8::/32 documentation
		(bytes[0] & 0xfe) === 0xfc || // fc00::/7 unique local
		(bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || // fe80::/10 link-local
		bytes[0] === 0xff // ff00::/8 multicast
	);
}

/**
 * Rejects destinations inside the server's network: names without a public domain and
 * private, loopback, link-local (cloud metadata) and reserved IPs. Hostnames that resolve
 * to private IPs need the instance-level N8N_SSRF_PROTECTION_ENABLED, which this node respects.
 */
export function isBlockedHost(hostname: string): boolean {
	const host = hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '');
	if (!host) return true;
	if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return true;

	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) return ipv4Blocked(ipv4.slice(1).map(Number));

	if (host.includes(':')) return ipv6Blocked(host);

	// A name without a dot is a local or container service name, such as "redis"
	return !host.includes('.');
}

function assertAllowedUrl(this: IExecuteFunctions, rawUrl: string, i: number): URL {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new NodeOperationError(this.getNode(), 'The file URL is not valid', { itemIndex: i });
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new NodeOperationError(
			this.getNode(),
			'The file URL must start with http:// or https://',
			{
				itemIndex: i,
			},
		);
	}
	if (url.username || url.password || isBlockedHost(url.hostname)) {
		throw new NodeOperationError(
			this.getNode(),
			'The file URL points to a private or local address',
			{
				itemIndex: i,
				description: 'Only public files can be sent. Use a binary field for internal files.',
			},
		);
	}
	return url;
}

/** Downloads a public file so it can be uploaded to Zellia, which does not accept URLs. */
export async function downloadFile(
	this: IExecuteFunctions,
	rawUrl: string,
	i: number,
	fileNameOverride = '',
): Promise<DownloadedFile> {
	let url = assertAllowedUrl.call(this, rawUrl, i);
	let response: IN8nHttpFullResponse | undefined;

	// Redirects are followed by hand so every hop is checked before it is requested
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		try {
			response = (await this.helpers.httpRequest({
				method: 'GET',
				url: url.toString(),
				encoding: 'arraybuffer',
				returnFullResponse: true,
				disableFollowRedirect: true,
				ignoreHttpStatusErrors: true,
				timeout: 30000,
			})) as IN8nHttpFullResponse;
		} catch {
			throw new NodeOperationError(this.getNode(), 'Could not download the file', {
				itemIndex: i,
				description: `URL: ${rawUrl}`,
			});
		}
		const status = Number(response.statusCode);
		if (status >= 300 && status < 400) {
			const location = headerValue(response.headers, 'location');
			if (!location || hop === MAX_REDIRECTS) {
				throw new NodeOperationError(
					this.getNode(),
					'Could not download the file (too many redirects)',
					{
						itemIndex: i,
						description: `URL: ${rawUrl}`,
					},
				);
			}
			url = assertAllowedUrl.call(this, new URL(location, url).toString(), i);
			continue;
		}
		if (status < 200 || status >= 300) {
			throw new NodeOperationError(this.getNode(), `Could not download the file (HTTP ${status})`, {
				itemIndex: i,
				description: `URL: ${rawUrl}`,
			});
		}
		break;
	}

	const body = response?.body as unknown;
	const data = Buffer.isBuffer(body)
		? body
		: Buffer.from((body ?? new ArrayBuffer(0)) as ArrayBuffer);
	if (data.length === 0) {
		throw new NodeOperationError(this.getNode(), 'The downloaded file is empty', {
			itemIndex: i,
			description: `URL: ${rawUrl}`,
		});
	}
	if (data.length > MAX_ATTACHMENT_BYTES) {
		throw new NodeOperationError(this.getNode(), 'The file is larger than 40 MB', {
			itemIndex: i,
			description: 'Zellia does not accept attachments above 40 MB.',
		});
	}

	const fileName =
		fileNameOverride.trim() ||
		fileNameFrom(url.toString(), headerValue(response?.headers, 'content-disposition'));
	return {
		data,
		fileName,
		mimeType: mimeTypeFrom(headerValue(response?.headers, 'content-type'), fileName),
	};
}
