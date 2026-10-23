import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	asArray,
	findContact,
	getZelliaCredentials,
	keyValuesToObject,
	normalizePhone,
	unwrapPayload,
	zelliaApiRequest,
	zelliaApiRequestAllItems,
} from '../GenericFunctions';

function buildContactBody(data: IDataObject, countryCode = ''): IDataObject {
	const body: IDataObject = {};
	if (data.name) body.name = String(data.name).trim();
	if (data.email) body.email = String(data.email).trim().toLowerCase();
	if (data.phone) body.phone_number = normalizePhone(String(data.phone), countryCode);
	if (data.identifier) body.identifier = String(data.identifier).trim();
	if (data.blocked !== undefined) body.blocked = data.blocked;
	const attributes = keyValuesToObject(data.customAttributes);
	if (Object.keys(attributes).length) body.custom_attributes = attributes;
	return body;
}

async function createContact(
	this: IExecuteFunctions,
	body: IDataObject,
	inboxId: unknown,
): Promise<IDataObject> {
	const requestBody = { ...body };
	if (inboxId) requestBody.inbox_id = Number(inboxId);
	const response = await zelliaApiRequest.call(this, 'POST', '/contacts', requestBody);
	const payload = unwrapPayload(response);
	const contact = (payload.contact as IDataObject | undefined) ?? payload;
	return payload.contact_inbox ? { ...contact, contact_inbox: payload.contact_inbox } : contact;
}

async function upsertContact(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const { defaultCountryCode: countryCode } = await getZelliaCredentials.call(this);
	const matchBy = this.getNodeParameter('matchBy', i) as 'phone' | 'email' | 'identifier';
	const rawValue = String(this.getNodeParameter('matchValue', i) ?? '').trim();
	const value =
		matchBy === 'phone'
			? normalizePhone(rawValue, countryCode)
			: matchBy === 'email'
				? rawValue.toLowerCase()
				: rawValue;
	if (!value) {
		throw new NodeOperationError(this.getNode(), 'The value to match is empty', { itemIndex: i });
	}
	const field = { phone: 'phone_number', email: 'email', identifier: 'identifier' }[matchBy];
	const body = buildContactBody(
		this.getNodeParameter('contactData', i, {}) as IDataObject,
		countryCode,
	);

	// Search is a fuzzy ILIKE, so keep only the exact match
	const existing = await findContact.call(this, value, (candidate) => {
		const current = String(candidate[field] ?? '');
		return matchBy === 'email' ? current.toLowerCase() === value : current === value;
	});

	if (existing) {
		if (!Object.keys(body).length) return { ...existing, upsertResult: 'found' };
		const response = await zelliaApiRequest.call(this, 'PUT', `/contacts/${existing.id}`, body);
		return { ...unwrapPayload(response), upsertResult: 'updated' };
	}

	const created = await createContact.call(
		this,
		{ ...body, [field]: value },
		this.getNodeParameter('inboxId', i, ''),
	);
	return { ...created, upsertResult: 'created' };
}

export async function executeContact(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const { defaultCountryCode: countryCode } = await getZelliaCredentials.call(this);
	switch (operation) {
		case 'create':
			return await createContact.call(
				this,
				buildContactBody(this.getNodeParameter('contactData', i, {}) as IDataObject, countryCode),
				this.getNodeParameter('inboxId', i, ''),
			);

		case 'upsert':
			return await upsertContact.call(this, i);

		case 'get': {
			const contactId = this.getNodeParameter('contactId', i) as number;
			return unwrapPayload(await zelliaApiRequest.call(this, 'GET', `/contacts/${contactId}`));
		}

		case 'update': {
			const contactId = this.getNodeParameter('contactId', i) as number;
			const body = buildContactBody(
				this.getNodeParameter('contactData', i, {}) as IDataObject,
				countryCode,
			);
			if (!Object.keys(body).length) {
				throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
					itemIndex: i,
				});
			}
			return unwrapPayload(
				await zelliaApiRequest.call(this, 'PUT', `/contacts/${contactId}`, body),
			);
		}

		case 'search': {
			const returnAll = this.getNodeParameter('returnAll', i) as boolean;
			const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
			return await zelliaApiRequestAllItems.call(
				this,
				'/contacts/search',
				{ q: String(this.getNodeParameter('query', i)).trim() },
				(response) => asArray(response.payload),
				limit,
			);
		}

		case 'getConversations': {
			const contactId = this.getNodeParameter('contactId', i) as number;
			const response = await zelliaApiRequest.call(
				this,
				'GET',
				`/contacts/${contactId}/conversations`,
			);
			return asArray(response.payload);
		}
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
		itemIndex: i,
	});
}
