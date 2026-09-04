export interface BridgeConfig {
  companyName: string
  locale: string
  greeting: string
  filler: string
  promptAdditions: Array<string>
  transfer: { mainLineNumber: string | null; voicemailNumber: string | null }
  maxCallDurationMinutes: number
}
