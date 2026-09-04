import { logger } from '../logger.js'
import type { BridgeConfig } from '../config/types.js'
import type { Transport } from '../transport/Transport.js'

/**
 * Mirrors `agents.voice.approved_destinations` in unit-hq-api's
 * config/agents.php: the backend only ever asks for one of these two.
 */
export type TransferDestination = 'main_line' | 'voicemail'

function isTransferDestination(value: string): value is TransferDestination {
  return value === 'main_line' || value === 'voicemail'
}

function numberFor(
  destination: TransferDestination,
  transfer: BridgeConfig['transfer']
): string {
  const number = destination === 'main_line' ? transfer.mainLineNumber : transfer.voicemailNumber
  return number ?? ''
}

/**
 * Turns the backend's `destination` string into a vendor-specific transfer
 * action. Unknown/missing destinations fall back to `main_line`, matching
 * the backend's own `outside_hours_destination`/`reason_destinations`
 * defaults — we never leave a caller connected to nothing.
 */
export async function runTransfer(
  transport: Transport,
  destination: string | undefined,
  sessionId: string,
  transfer: BridgeConfig['transfer']
): Promise<void> {
  const resolved: TransferDestination =
    destination !== undefined && isTransferDestination(destination) ? destination : 'main_line'
  const number = numberFor(resolved, transfer)

  if (number === '') {
    logger.warn({ sessionId, destination: resolved }, 'transfer.destination_not_configured')
    await transport.close('error')

    return
  }

  logger.info({ sessionId, destination: resolved }, 'transfer.dispatching')
  await transport.transfer(number)
}
