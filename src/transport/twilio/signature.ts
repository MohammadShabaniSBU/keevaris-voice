import twilio from 'twilio'
import { config } from '../../config.js'
import { logger } from '../../logger.js'

/**
 * Validates `X-Twilio-Signature` on the `/twilio/voice` webhook. Set
 * `TWILIO_VALIDATE_SIGNATURE=false` locally when testing through a tunnel
 * without real Twilio credentials configured yet.
 */
export function isValidTwilioSignature(
  fullUrl: string,
  params: Record<string, string>,
  signatureHeader: string | Array<string> | undefined
): boolean {
  if (!config.twilio.validateSignature) {
    return true
  }

  if (config.twilio.authToken === '') {
    logger.warn({}, 'twilio.signature_check_skipped_no_auth_token')

    return false
  }

  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader
  if (signature === undefined) {
    return false
  }

  return twilio.validateRequest(config.twilio.authToken, signature, fullUrl, params)
}
