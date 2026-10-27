'use strict'

const { spawnSync } = require('child_process')
const { writeFileSync } = require('fs')
const { join } = require('path')
const { Readable, Writable } = require('stream')

const PACKAGE_PATH = join(__dirname, '..')
const send = require(PACKAGE_PATH)
const { sendStream } = send

const RUNS = 7
const TEXT_SENDS = 500_000
const BUFFER_SENDS = 4_000_000
const SNIFFED_STREAMS = 3_000
const PRESET_STREAMS = 10_000
const STREAM_BYTES = 64 * 1024
const STREAM_CHUNK_BYTES = 16 * 1024

const JPEG_SIGNATURE = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46
])
const STREAM_BODY = Buffer.concat([
  JPEG_SIGNATURE,
  Buffer.alloc(STREAM_BYTES - JPEG_SIGNATURE.length, 7)
])

const STRING_BODY = 'x'.repeat(1024)
const OBJECT_BODY = {
  id: 123,
  name: 'send-http',
  tags: ['http', 'response', 'stream'],
  nested: { ok: true, count: 42, ratio: 0.5 }
}
const BUFFER_BODY = Buffer.alloc(1024, 7)

const median = values => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const now = () => process.hrtime.bigint()

const elapsed = started => Number(now() - started) / 1e6

const headerMethods = {
  setHeader (name, value) {
    this.headers[name] = value
  },
  getHeader (name) {
    return this.headers[name]
  },
  hasHeader (name) {
    return this.headers[name] !== undefined
  }
}

const createResponse = () => ({
  ...headerMethods,
  statusCode: 200,
  headers: {},
  headersSent: false,
  writableEnded: false,
  body: undefined,
  end (body) {
    this.body = body
    this.headersSent = true
    this.writableEnded = true
  }
})

class ResponseSink extends Writable {
  constructor () {
    super()
    this.statusCode = 200
    this.headers = {}
    this.headersSent = false
    this.bytes = 0
  }

  _write (chunk, encoding, callback) {
    this.headersSent = true
    this.bytes += chunk.length
    callback()
  }
}

Object.assign(ResponseSink.prototype, headerMethods)

const createBodyStream = () => {
  let offset = 0
  return new Readable({
    read () {
      if (offset >= STREAM_BYTES) return this.push(null)
      this.push(STREAM_BODY.subarray(offset, offset + STREAM_CHUNK_BYTES))
      offset += STREAM_CHUNK_BYTES
    }
  })
}

const sendCase = (name, sends, body, contentType) => {
  const expectedLength = Buffer.isBuffer(body)
    ? body.length
    : Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body))
  return {
    name,
    extra: `work ${sends} sends of ${expectedLength} bytes`,
    run: () => {
      let failures = 0
      for (let i = 0; i < sends; i++) {
        const res = createResponse()
        send(res, 200, body)
        if (
          res.body.length !== expectedLength ||
          res.headers['content-length'] !== expectedLength ||
          res.headers['content-type'] !== contentType
        ) {
          failures++
        }
      }
      if (failures > 0) throw new Error(`${name}: ${failures} wrong responses`)
    }
  }
}

const streamOnce = presetContentType =>
  new Promise((resolve, reject) => {
    const res = new ResponseSink()
    if (presetContentType) res.setHeader('content-type', presetContentType)
    res.once('error', reject)
    res.once('finish', () => resolve(res))
    sendStream(res, 200, createBodyStream())
  })

const streamCase = (name, streams, presetContentType, contentType) => ({
  name,
  extra: `work ${streams} streams of ${STREAM_BYTES} bytes`,
  run: async () => {
    let failures = 0
    for (let i = 0; i < streams; i++) {
      const res = await streamOnce(presetContentType)
      if (
        res.bytes !== STREAM_BYTES ||
        res.headers['content-type'] !== contentType
      ) {
        failures++
      }
    }
    if (failures > 0) throw new Error(`${name}: ${failures} wrong responses`)
  }
})

const spawnNode = script => {
  const started = now()
  const child = spawnSync(process.execPath, ['-e', script], {
    stdio: 'inherit'
  })
  const wall = elapsed(started)
  if (child.status !== 0) { throw new Error(`node -e ${script} exited ${child.status}`) }
  return wall
}

const REQUIRE_SCRIPT = `require(${JSON.stringify(PACKAGE_PATH)})`
const BASELINE_SCRIPT = '0'

const sampleColdRequire = () => {
  const required = []
  const baseline = []
  let errors = 0
  for (let run = 0; run <= RUNS; run++) {
    try {
      const requireWall = spawnNode(REQUIRE_SCRIPT)
      const baselineWall = spawnNode(BASELINE_SCRIPT)
      if (run === 0) continue
      required.push(requireWall)
      baseline.push(baselineWall)
    } catch (error) {
      errors++
      console.error(error)
    }
  }
  const spawnCost = baseline.length ? median(baseline) : Number.NaN
  return { samples: required.map(wall => wall - spawnCost), errors, spawnCost }
}

const coldRequireCase = {
  name: 'cold require',
  extra: 'work 1 require of send-http, median node -e 0 spawn subtracted',
  sample: sampleColdRequire
}

const CASES = [
  sendCase('send string', TEXT_SENDS, STRING_BODY, 'text/plain; charset=utf-8'),
  sendCase(
    'send object',
    TEXT_SENDS,
    OBJECT_BODY,
    'application/json; charset=utf-8'
  ),
  sendCase(
    'send buffer',
    BUFFER_SENDS,
    BUFFER_BODY,
    'application/octet-stream'
  ),
  streamCase('sendStream sniffed', SNIFFED_STREAMS, undefined, 'image/jpeg'),
  streamCase(
    'sendStream preset type',
    PRESET_STREAMS,
    'text/plain',
    'text/plain'
  ),
  coldRequireCase
]

const sampleWorkload = async entry => {
  const samples = []
  let errors = 0
  for (let run = 0; run <= RUNS; run++) {
    try {
      const started = now()
      await entry.run()
      const wall = elapsed(started)
      if (run > 0) samples.push(wall)
    } catch (error) {
      errors++
      console.error(error)
    }
  }
  return { samples, errors }
}

const fmt = value => value.toFixed(1)

const report = (entry, { samples, errors }) => {
  const med = samples.length ? median(samples) : Number.NaN
  const min = samples.length ? Math.min(...samples) : Number.NaN
  const max = samples.length ? Math.max(...samples) : Number.NaN
  const extra = `${entry.extra}, errors ${errors}, runs ${RUNS}`
  console.log(
    `${entry.name}  median ${fmt(med)}ms  range ${fmt(min)}-${fmt(
      max
    )}  ${extra}`
  )
  return {
    name: entry.name,
    unit: 'ms',
    value: Number(fmt(med)),
    range: `${fmt(min)}-${fmt(max)}`,
    extra
  }
}

const main = async () => {
  const results = []
  let errors = 0
  for (const entry of CASES) {
    const result = await (entry.sample ?? sampleWorkload)(entry)
    errors += result.errors
    results.push(report(entry, result))
  }
  writeFileSync(
    join(__dirname, '..', 'benchmark-output.json'),
    JSON.stringify(results, null, 2) + '\n'
  )
  if (errors > 0 || results.some(result => !Number.isFinite(result.value))) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
