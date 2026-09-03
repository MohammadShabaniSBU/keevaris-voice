# V01-03 — Audio buffering across the Deepgram handshake

**Depends on:** V01-02
**Blocks:** nothing
**Touches:** `keevaris-voice`

## Problem

`VoiceSession.start()` registers `transport.onAudio((chunk) => agent.sendAudio(chunk))` and
then awaits `agent.start()`. Everything Twilio sends during the handshake — TCP connect, TLS,
the `Settings` round trip, `SettingsApplied` — reaches `sendAudio`, fails the
`readyState === OPEN` check, and is discarded without a log line.

On a phone call that window is realistically a few hundred milliseconds, and it lands exactly
where the caller is most likely to speak: over the greeting, which we deliberately play as
Deepgram's `agent.greeting` so the disclosure line is guaranteed verbatim. An eager caller
says "hi, do you have any small units" and the transcript starts at "units". The fast model
delegates a question with a missing subject, `AgentRuntime` grounds an answer to it, and the
caller is told about something they did not ask.

The failure is invisible. There is no counter, no warning, and the resulting call sounds like
a model that misunderstood rather than a pipeline that dropped bytes.

## What to build

### A bounded prebuffer inside the agent

The buffer belongs in `DeepgramVoiceAgent`, not in `VoiceSession`. `VoiceSession` should keep
handing audio to `AgentProvider` unconditionally; when the far end is ready is the
provider's problem, and a replacement provider will have the same problem in a different
shape.

- Before `SettingsApplied`, `sendAudio` appends to a queue.
- On `SettingsApplied`, flush the queue in arrival order, then send live.
- The queue is bounded **by bytes, not by chunk count**, because chunk size differs per
  transport. Size it in duration: two seconds of the transport's input format is a sensible
  ceiling, computed from `AudioFormat` rather than hardcoded, since Twilio is mulaw 8 kHz and
  web is linear16 16 kHz.
- Past the ceiling, drop the **oldest** and increment a counter. Dropping the oldest keeps
  the most recent speech, which is the part that matters; and a call that overflows a
  two-second prebuffer has a handshake problem worth an alert, not a buffering problem.
- Log at `info` on flush with the buffered byte count and duration, and at `warn` on any
  drop. This number is the evidence that the fix works and the early warning if Deepgram
  connect latency degrades.

### Do not resample

The prebuffer stores what the transport produced. `Settings.audio.input` already declares the
transport's own encoding and sample rate so nothing is resampled anywhere in the path, which
is the reason the audio formats are on `Transport` at all. Buffering must not become the
place that quietly introduces a conversion.

### Verify barge-in on both transports

Adjacent and cheap to confirm while in this code. `UserStartedSpeaking` triggers
`transport.clearAudio()`, which is a Twilio `clear` event on one side and a
`{"type":"clear"}` text frame on the other. `public/dev.html` must actually honour that frame
and flush its playback queue, otherwise barge-in works on the phone and not in the browser,
and the browser is where it will be demoed. Cover both in the harness.

## Acceptance criteria

- [ ] Audio arriving before `SettingsApplied` is buffered and flushed in order.
- [ ] The buffer is bounded by duration derived from `AudioFormat`, not by a fixed chunk
      count.
- [ ] Overflow drops the oldest chunk and increments a logged counter.
- [ ] `caller-speaks-during-greeting.json` is green: the pre-handshake utterance appears in
      the transcript in the right order.
- [ ] Flush logs buffered bytes and duration at `info`; drops log at `warn`.
- [ ] No resampling is introduced; the harness asserts flushed bytes are identical to the
      bytes the transport emitted.
- [ ] Barge-in clears playback on both Twilio and web, asserted in the harness and confirmed
      by hand in `dev.html`.

## Out of scope

- **Tuning endpointing or VAD sensitivity.** Deepgram owns turn detection. If the caller is
  being cut off or not detected, that is a `Settings` change and belongs with the prompt and
  model configuration work in V03.
- **Jitter buffering during a call.** This is a startup-window fix only. Mid-call packet
  timing is Twilio's and Deepgram's problem and there is no evidence we have one.
- **Buffering agent audio toward the transport.** The reverse direction is not affected: the
  transport exists before the agent produces anything.
