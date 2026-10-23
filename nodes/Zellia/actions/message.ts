import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { asArray, buildMultipart, zelliaApiRequest } from '../GenericFunctions';
import type { DownloadedFile } from './download';
import { downloadFile } from './download';

function collectionValues(ctx: IExecuteFunctions, name: string, i: number): IDataObject[] {
	const collection = ctx.getNodeParameter(name, i, {}) as IDataObject;
	return asArray(collection.values);
}

/** Builds the body of POST /messages from the shared message fields. */
export function buildMessageBody(this: IExecuteFunctions, i: number): IDataObject {
	const kind = this.getNodeParameter('messageKind', i) as string;
	const options = this.getNodeParameter('messageOptions', i, {}) as IDataObject;
	const body: IDataObject = { message_type: 'outgoing' };
	const contentAttributes: IDataObject = {};

	const content = () => String(this.getNodeParameter('content', i, '') ?? '');

	switch (kind) {
		case 'text':
		case 'note': {
			const text = content();
			if (!text.trim()) {
				throw new NodeOperationError(this.getNode(), 'The message content is empty', {
					itemIndex: i,
				});
			}
			body.content = text;
			if (kind === 'note') body.private = true;
			break;
		}
		case 'buttons': {
			const items = collectionValues(this, 'buttons', i)
				.map((button) => {
					const title = String(button.title ?? '').trim();
					const value = String(button.value ?? '').trim() || title;
					return { title, value };
				})
				.filter((button) => button.title !== '');
			if (!items.length) {
				throw new NodeOperationError(this.getNode(), 'Add at least one button', { itemIndex: i });
			}
			body.content = content();
			body.content_type = 'input_select';
			contentAttributes.items = items;
			break;
		}
		case 'cards': {
			const items = collectionValues(this, 'cards', i).map((card) => {
				const actions: IDataObject[] = [];
				const text = String(card.buttonText ?? '').trim();
				if (text) {
					const type = String(card.buttonType ?? 'link');
					const value = String(card.buttonValue ?? '');
					actions.push(
						type === 'link' ? { type, text, uri: value } : { type, text, payload: value },
					);
				}
				return {
					title: String(card.title ?? ''),
					description: String(card.description ?? ''),
					media_url: String(card.mediaUrl ?? ''),
					actions,
				};
			});
			if (!items.length) {
				throw new NodeOperationError(this.getNode(), 'Add at least one card', { itemIndex: i });
			}
			const text = content();
			if (text) body.content = text;
			body.content_type = 'cards';
			contentAttributes.items = items;
			break;
		}
		case 'template': {
			const name = String(this.getNodeParameter('templateName', i) ?? '').trim();
			if (!name) {
				throw new NodeOperationError(this.getNode(), 'The template name is empty', {
					itemIndex: i,
				});
			}
			const format = this.getNodeParameter('templateParamsFormat', i) as string;
			// Zellia's current format groups variables by template component
			const bodyParams: IDataObject = {};
			if (format === 'named') {
				for (const variable of collectionValues(this, 'templateNamed', i)) {
					const key = String(variable.key ?? '').trim();
					if (key) bodyParams[key] = String(variable.value ?? '');
				}
			} else {
				collectionValues(this, 'templatePositional', i).forEach((variable, index) => {
					bodyParams[String(index + 1)] = String(variable.value ?? '');
				});
			}
			const processedParams: IDataObject = Object.keys(bodyParams).length
				? { body: bodyParams }
				: {};
			body.template_params = {
				name,
				category: this.getNodeParameter('templateCategory', i),
				language: this.getNodeParameter('templateLanguage', i),
				processed_params: processedParams,
			};
			const shown = String(this.getNodeParameter('templateContent', i, '') ?? '');
			if (shown) body.content = shown;
			break;
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown message type "${kind}"`, {
				itemIndex: i,
			});
	}

	if (Number(options.replyToMessageId) > 0) {
		contentAttributes.in_reply_to = Number(options.replyToMessageId);
	}
	if (Object.keys(contentAttributes).length) body.content_attributes = contentAttributes;
	if (Number(options.senderBotId) > 0) {
		body.sender_type = 'AgentBot';
		body.sender_id = Number(options.senderBotId);
	}
	return body;
}

/** The file to attach, from a binary field or downloaded from a URL. */
async function readAttachment(this: IExecuteFunctions, i: number): Promise<DownloadedFile> {
	const fileSource = this.getNodeParameter('fileSource', i, 'binary') as string;
	if (fileSource === 'url') {
		const url = String(this.getNodeParameter('fileUrl', i) ?? '').trim();
		const fileName = String(this.getNodeParameter('fileName', i, '') ?? '');
		return await downloadFile.call(this, url, i, fileName);
	}
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
	const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
	return {
		data: await this.helpers.getBinaryDataBuffer(i, binaryPropertyName),
		fileName: binaryData.fileName ?? `file.${binaryData.fileExtension ?? 'bin'}`,
		mimeType: binaryData.mimeType || 'application/octet-stream',
	};
}

export async function postMessage(
	this: IExecuteFunctions,
	conversationId: number,
	body: IDataObject,
): Promise<IDataObject> {
	return await zelliaApiRequest.call(
		this,
		'POST',
		`/conversations/${conversationId}/messages`,
		body,
	);
}

export async function executeMessage(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const conversationId = this.getNodeParameter('conversationId', i) as number;

	if (operation === 'send') {
		return await postMessage.call(this, conversationId, buildMessageBody.call(this, i));
	}

	if (operation === 'sendAttachment') {
		const file = await readAttachment.call(this, i);
		const fields: Record<string, string> = {
			message_type: 'outgoing',
			private: String(this.getNodeParameter('private', i, false) as boolean),
		};
		const caption = String(this.getNodeParameter('caption', i, '') ?? '');
		if (caption) fields.content = caption;
		const { body, contentType } = buildMultipart(fields, { field: 'attachments[]', ...file });
		return await zelliaApiRequest.call(
			this,
			'POST',
			`/conversations/${conversationId}/messages`,
			body,
			undefined,
			{ json: false, headers: { 'Content-Type': contentType } },
		);
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
		itemIndex: i,
	});
}
