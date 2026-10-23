import { promises as dns } from 'dns';
import type { Readable } from 'stream';

import type { IExecuteFunctions, IN8nHttpFullResponse } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// Zellia rejects uploads above MAXIMUM_FILE_UPLOAD_SIZE, 40 MB by default
export const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;

const MAX_REDIRECTS = 3;

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

/** Resolves a hostname to all its addresses. Replaceable in tests. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) =>
	(await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

let resolveHost: HostResolver = defaultResolver;

/** Test hook: swap the DNS resolver. Pass nothing to restore the real one. */
export function setHostResolver(resolver?: HostResolver): void {
	resolveHost = resolver ?? defaultResolver;
}

function headerValue(headers: IN8nHttpFullResponse['headers'] | undefined, name: string): string {
	const value = headers?.[name] ?? headers?.[name.toLowerCase()];
	return String(Array.isArray(value) ? value[0] : (value ?? ''));
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** File name from Content-Disposition (filename* first), else the last path segment of the URL. */
export function fileNameFrom(url: string, contentDisposition: string): string {
	const extended = contentDisposition.match(
		/filename\*\s*=\s*(?:[\w-]+'[^']*')?"?([^";]+)"?/i,
	)?.[1];
	const plain = contentDisposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
	const fromHeader = extended ?? plain;
	if (fromHeader) return safeDecode(fromHeader.trim());
	try {
		const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
		if (segment) return safeDecode(segment);
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

function ipv4Blocked(parts: number[]): boolean {
	const [a, b, c] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
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
 * carry an IPv4 address inside (IPv4-mapped, IPv4-translated, compatible, NAT64, 6to4, Teredo).
 */
function ipv6Blocked(address: string): boolean {
	const bytes = parseIpv6(address);
	if (!bytes) return true;
	const zeros = (count: number) => Array<number>(count).fill(0);
	if (startsWith(bytes, [...zeros(10), 0xff, 0xff])) return ipv4Blocked(bytes.slice(12));
	return (
		startsWith(bytes, zeros(12)) || // ::/96: unspecified, loopback and IPv4-compatible
		startsWith(bytes, [...zeros(8), 0xff, 0xff, 0, 0]) || // ::ffff:0:0/96 IPv4-translated
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

/** True for an IP literal (v4 or v6) inside a private, local or reserved range. */
export function isBlockedIp(address: string): boolean {
	const host = address.replace(/^\[|\]$/g, '');
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) return ipv4Blocked(ipv4.slice(1).map(Number));
	return host.includes(':') ? ipv6Blocked(host) : true;
}

/**
 * Rejects hostnames inside the server's network by name: localhost, local suffixes,
 * names without a public domain, and private IP literals.
 */
export function isBlockedHost(hostname: string): boolean {
	const host = hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '');
	if (!host) return true;
	if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return true;
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return isBlockedIp(host);
	// A name without a dot is a local or container service name, such as "redis"
	return !host.includes('.');
}

async function assertAllowedUrl(this: IExecuteFunctions, rawUrl: string, i: number): Promise<URL> {
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
			{ itemIndex: i },
		);
	}
	const refuse = () =>
		new NodeOperationError(this.getNode(), 'The file URL points to a private or local address', {
			itemIndex: i,
			description: 'Only public files can be sent. Use a binary field for internal files.',
		});
	if (url.username || url.password || isBlockedHost(url.hostname)) throw refuse();

	// A public name can still point to a private address, so check every address it resolves to
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.includes(':')) {
		let addresses: string[];
		try {
			addresses = await resolveHost(host);
		} catch {
			throw new NodeOperationError(this.getNode(), 'Could not resolve the file URL', {
				itemIndex: i,
				description: `Host: ${host}`,
			});
		}
		if (!addresses.length || addresses.some(isBlockedIp)) throw refuse();
	}
	return url;
}

/** Reads a response stream, stopping as soon as it passes the size limit. */
async function readLimited(this: IExecuteFunctions, stream: Readable, i: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of stream) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
		size += buffer.length;
		if (size > MAX_ATTACHMENT_BYTES) {
			stream.destroy();
			throw new NodeOperationError(this.getNode(), 'The file is larger than 40 MB', {
				itemIndex: i,
				description: 'Zellia does not accept attachments above 40 MB.',
			});
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

function toStream(body: unknown): Readable | undefined {
	return body && typeof (body as Readable)[Symbol.asyncIterator] === 'function'
		? (body as Readable)
		: undefined;
}

/** Downloads a public file so it can be uploaded to Zellia, which does not accept URLs. */
export async function downloadFile(
	this: IExecuteFunctions,
	rawUrl: string,
	i: number,
	fileNameOverride = '',
): Promise<DownloadedFile> {
	let url = await assertAllowedUrl.call(this, rawUrl, i);
	const fail = (message: string) =>
		new NodeOperationError(this.getNode(), message, {
			itemIndex: i,
			description: `URL: ${rawUrl}`,
		});

	// Redirects are followed by hand so every hop is checked before it is requested
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		let response: IN8nHttpFullResponse;
		try {
			response = (await this.helpers.httpRequest({
				method: 'GET',
				url: url.toString(),
				encoding: 'stream',
				returnFullResponse: true,
				disableFollowRedirect: true,
				ignoreHttpStatusErrors: true,
				timeout: 30000,
			})) as IN8nHttpFullResponse;
		} catch {
			throw fail('Could not download the file');
		}
		const stream = toStream(response.body);
		const status = Number(response.statusCode);

		if (status >= 300 && status < 400) {
			stream?.destroy();
			const location = headerValue(response.headers, 'location');
			if (!location)
				throw fail(`Could not download the file (HTTP ${status} without a new address)`);
			if (hop === MAX_REDIRECTS) throw fail('Could not download the file (too many redirects)');
			let next: string;
			try {
				next = new URL(location, url).toString();
			} catch {
				throw fail('Could not download the file (invalid redirect address)');
			}
			url = await assertAllowedUrl.call(this, next, i);
			continue;
		}
		if (status < 200 || status >= 300) {
			stream?.destroy();
			throw fail(`Could not download the file (HTTP ${status})`);
		}

		const declaredSize = Number(headerValue(response.headers, 'content-length'));
		if (Number.isFinite(declaredSize) && declaredSize > MAX_ATTACHMENT_BYTES) {
			stream?.destroy();
			throw new NodeOperationError(this.getNode(), 'The file is larger than 40 MB', {
				itemIndex: i,
				description: 'Zellia does not accept attachments above 40 MB.',
			});
		}

		const data = stream
			? await readLimited.call(this, stream, i)
			: Buffer.from((response.body ?? []) as Uint8Array);
		if (data.length === 0) throw fail('The downloaded file is empty');
		if (data.length > MAX_ATTACHMENT_BYTES) {
			throw new NodeOperationError(this.getNode(), 'The file is larger than 40 MB', {
				itemIndex: i,
				description: 'Zellia does not accept attachments above 40 MB.',
			});
		}

		const fileName =
			fileNameOverride.trim() ||
			fileNameFrom(url.toString(), headerValue(response.headers, 'content-disposition'));
		return {
			data,
			fileName,
			mimeType: mimeTypeFrom(headerValue(response.headers, 'content-type'), fileName),
		};
	}
	throw fail('Could not download the file (too many redirects)');
}
