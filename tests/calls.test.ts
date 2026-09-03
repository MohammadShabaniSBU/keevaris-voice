import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseFixture } from './fixtureTypes.js'
import { runFixture } from './runFixture.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/calls')
const files = readdirSync(fixturesDir)
  .filter((name) => name.endsWith('.json'))
  .sort()

for (const file of files) {
  test(file, async (t) => {
    const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'))
    const fixture = parseFixture(raw)
    await runFixture(fixture, t)
  })
}
