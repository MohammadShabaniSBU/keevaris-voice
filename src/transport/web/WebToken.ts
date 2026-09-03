import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export interface WebTokenClaims {
  sessionId: string
  purpose: string
  expiresAt: number
}

export interface MintedWebToken {
  token: string
  sessionId: string
  expiresAt: number
}

const HMAC_SHA256_LENGTH = 32

function base64UrlEncode(value: string | Buffer): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value

  return buffer.toString('base64url')
}

function base64UrlDecode(value: string): Buffer | null {
  try {
    return Buffer.from(value, 'base64url')
  } catch {
    return null
  }
}

export class WebTokenService {
  private readonly consumed = new Map<string, number>()

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now
  ) {}

  mint(purpose: string, ttlMs: number): MintedWebToken {
    const expiresAt = this.now() + ttlMs
    const claims: WebTokenClaims = {
      sessionId: randomUUID(),
      purpose,
      expiresAt
    }
    const payload = base64UrlEncode(JSON.stringify(claims))
    const signature = this.sign(payload)

    return {
      token: `${payload}.${signature}`,
      sessionId: claims.sessionId,
      expiresAt
    }
  }

  verify(token: string | null): WebTokenClaims | null {
    this.pruneConsumed()

    if (token === null || token === '') {
      return null
    }

    const separatorIndex = token.lastIndexOf('.')
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
      return null
    }

    const payload = token.slice(0, separatorIndex)
    const signatureSegment = token.slice(separatorIndex + 1)
    const providedSignature = base64UrlDecode(signatureSegment)
    if (providedSignature === null || providedSignature.length !== HMAC_SHA256_LENGTH) {
      return null
    }

    const expectedSignature = Buffer.from(this.sign(payload), 'base64url')
    if (expectedSignature.length !== HMAC_SHA256_LENGTH) {
      return null
    }

    if (!timingSafeEqual(providedSignature, expectedSignature)) {
      return null
    }

    let claims: WebTokenClaims
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as WebTokenClaims
    } catch {
      return null
    }

    if (
      typeof claims.sessionId !== 'string' ||
      typeof claims.purpose !== 'string' ||
      typeof claims.expiresAt !== 'number'
    ) {
      return null
    }

    if (claims.expiresAt <= this.now()) {
      return null
    }

    if (this.consumed.has(claims.sessionId)) {
      return null
    }

    this.consumed.set(claims.sessionId, claims.expiresAt)

    return claims
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url')
  }

  private pruneConsumed(): void {
    const now = this.now()
    for (const [sessionId, expiresAt] of this.consumed.entries()) {
      if (expiresAt <= now) {
        this.consumed.delete(sessionId)
      }
    }
  }
}
