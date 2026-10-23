import { createHmac, timingSafeEqual } from 'crypto';

// Reject deliveries older than this, so a captured request cannot be replayed later
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

/** Checks X-Chatwoot-Signature: sha256=HMAC(secret, "<timestamp>.<raw body>"). */
export function verifySignature(
	secret: string,
	timestamp: string,
	signature: string,
	rawBody: Buffer,
	nowSeconds = Date.now() / 1000,
): boolean {
	const ts = Number(timestamp);
	if (!timestamp || !Number.isFinite(ts)) return false;
	if (Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;
	const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
	return safeEqual(`sha256=${digest}`, signature);
}
