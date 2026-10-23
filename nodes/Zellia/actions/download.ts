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

function headerValue(headers: IN8nHttpFullResponse['headers'], name: string): string {
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

/** Downloads a public file so it can be uploaded to Zellia, which does not accept URLs. */
export async function downloadFile(
	this: IExecuteFunctions,
	url: string,
	i: number,
	fileNameOverride = '',
): Promise<DownloadedFile> {
	if (!/^https?:\/\//i.test(url)) {
		throw new NodeOperationError(
			this.getNode(),
			'The file URL must start with http:// or https://',
			{
				itemIndex: i,
			},
		);
	}

	let response: IN8nHttpFullResponse;
	try {
		response = (await this.helpers.httpRequest({
			method: 'GET',
			url,
			encoding: 'arraybuffer',
			returnFullResponse: true,
			timeout: 30000,
		})) as IN8nHttpFullResponse;
	} catch (error) {
		const failure = error as { httpCode?: string; response?: { status?: number } };
		const status = failure.httpCode ?? failure.response?.status;
		throw new NodeOperationError(
			this.getNode(),
			`Could not download the file${status ? ` (HTTP ${status})` : ''}`,
			{ itemIndex: i, description: `URL: ${url}` },
		);
	}

	const body = response.body as unknown;
	const data = Buffer.isBuffer(body) ? body : Buffer.from(body as ArrayBuffer);
	if (data.length === 0) {
		throw new NodeOperationError(this.getNode(), 'The downloaded file is empty', {
			itemIndex: i,
			description: `URL: ${url}`,
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
		fileNameFrom(url, headerValue(response.headers, 'content-disposition'));
	return {
		data,
		fileName,
		mimeType: mimeTypeFrom(headerValue(response.headers, 'content-type'), fileName),
	};
}
