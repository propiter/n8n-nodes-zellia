'use strict';
// Test doubles for the n8n function contexts. Routes answer like the Zellia API.

const CREDENTIALS = { baseUrl: 'https://zellia.test/', accountId: 7, accessToken: 'test-token' };

class HttpError extends Error {
	constructor(status, data) {
		super(`HTTP ${status}`);
		this.httpCode = String(status);
		this.response = { status, data };
	}
}

/**
 * routes: { 'GET /pipelines/2/stages': response | (options) => response }
 * Paths are relative to /api/v1/accounts/7. A thrown HttpError simulates an API failure.
 */
function createContext({ params = {}, routes = {}, binary, downloads = {}, credentials = {} } = {}) {
	const calls = [];
	const prefix = `/api/v1/accounts/${CREDENTIALS.accountId}`;
	const staticData = {};
	const context = {
		calls,
		staticData,
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, indexOrFallback, fallback) => {
			if (name in params) return params[name];
			// Hook and webhook contexts call getNodeParameter(name, fallback)
			return typeof indexOrFallback === 'number' ? fallback : indexOrFallback;
		},
		getCurrentNodeParameter: (name) => params[name],
		getCredentials: async (type) => (type === 'zelliaApi' || !type ? { ...CREDENTIALS, ...credentials } : credentials[type] || {}),
		getNode: () => ({ name: 'Zellia', type: 'n8n-nodes-zellia.zellia', typeVersion: 1, parameters: {} }),
		getWorkflow: () => ({ name: 'Test workflow' }),
		getNodeWebhookUrl: () => 'https://n8n.test/webhook/abc/webhook',
		getWorkflowStaticData: () => staticData,
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (credentialName, options) => {
				const url = new URL(options.url);
				const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
				const call = { method: options.method, path, qs: options.qs, body: options.body, headers: options.headers, search: url.search };
				calls.push(call);
				const key = `${options.method} ${path}`;
				if (!(key in routes)) throw new HttpError(404, { error: 'Resource could not be found' });
				const handler = routes[key];
				return typeof handler === 'function' ? handler(call) : handler;
			},
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (items, { itemData }) => items.map((item) => ({ ...item, pairedItem: itemData })),
			// Plain downloads (no Zellia auth). downloads: { url: { status, body, headers } }
			httpRequest: async (options) => {
				calls.push({ method: options.method, download: options.url, noRedirect: options.disableFollowRedirect });
				const file = downloads[options.url];
				if (!file) return { statusCode: 404, headers: {}, body: Buffer.alloc(0) };
				return { statusCode: file.status, headers: file.headers || {}, body: file.body || Buffer.alloc(0) };
			},
			assertBinaryData: () => binary.meta,
			getBinaryDataBuffer: async () => binary.data,
		},
	};
	return context;
}

/** Fake transport for URL downloads: { url: { status, body, headers } }. Records each GET in calls. */
function makeFetcher(downloads, calls) {
	const { Readable } = require('node:stream');
	return async (url) => {
		const key = url.toString();
		calls.push({ method: 'GET', download: key });
		const file = downloads[key];
		if (!file) return { statusCode: 404, headers: {}, body: Readable.from([]) };
		return { statusCode: file.status, headers: file.headers || {}, body: Readable.from(file.body ? [file.body] : []) };
	};
}

module.exports = { createContext, makeFetcher, HttpError, CREDENTIALS };
