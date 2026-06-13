import crypto from 'crypto';

interface SSOPayload {
  email: string;
  name: string;
  tenant: string;
  iat: number;
  exp: number;
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function verifySSOToken(token: string, secret: string): SSOPayload {
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Invalid token format');

  const [payload, signature] = parts;

  // Verify HMAC signature
  const expectedSig = base64urlEncode(
    crypto.createHmac('sha256', secret).update(payload).digest()
  );

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new Error('Invalid signature');
  }

  // Decode payload
  const data: SSOPayload = JSON.parse(base64urlDecode(payload).toString('utf-8'));

  // Check expiry
  if (data.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return data;
}
