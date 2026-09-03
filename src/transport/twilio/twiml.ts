export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * `<Connect><Stream>` (bidirectional Twilio Media Streams — not
 * ConversationRelay). We own STT/TTS via Deepgram, so we want raw audio in
 * and out, not a Twilio-managed conversational layer.
 */
export function buildStreamTwiml(streamUrl: string, parameters: Record<string, string> = {}): string {
  const parameterTags = Object.entries(parameters)
    .map(([name, value]) => `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}" />`)
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response>' +
    `<Connect><Stream url="${escapeXml(streamUrl)}">${parameterTags}</Stream></Connect>` +
    '</Response>'
  )
}

export function buildDialTwiml(destinationNumber: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Response><Dial>${escapeXml(destinationNumber)}</Dial></Response>`
  )
}
