'use strict'

const { default: listen } = require('async-listen')
const { Agent, createServer, get } = require('http')
const { EventEmitter } = require('events')
const { Readable } = require('stream')
const test = require('ava').default
const got = require('got')

const send = require('..')
const { proxy, sendStream } = send

const REQUESTS = 20
const BODY = Buffer.alloc(9000, 7)
const CONTENT_TYPE = { 'content-type': 'image/jpeg' }

const totalListeners = emitter =>
  emitter
    .eventNames()
    .reduce((total, event) => total + emitter.listenerCount(event), 0)

const trackPeaks = emitter => {
  const peaks = {}
  emitter.on('newListener', event => {
    peaks[event] = Math.max(peaks[event] ?? 0, emitter.listenerCount(event) + 1)
  })
  return peaks
}

const runServer = async (t, handler) => {
  const server = createServer(handler)
  const url = await listen(server)
  t.teardown(() => {
    server.closeAllConnections()
    return server[Symbol.asyncDispose]()
  })
  return url
}

const runTrackedServer = async (t, respond) => {
  const requests = []
  const url = await runServer(t, (req, res) => {
    requests.push({
      socket: req.socket,
      socketListeners: totalListeners(req.socket),
      peaks: trackPeaks(res)
    })
    respond(req, res)
  })
  return { url, requests }
}

const requestSequentially = async url => {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  for (let index = 0; index < REQUESTS; index++) {
    await new Promise((resolve, reject) =>
      get(url, { agent }, res => res.resume().once('end', resolve)).once(
        'error',
        reject
      )
    )
  }
  agent.destroy()
}

const assertNoLeak = (t, requests) => {
  t.is(requests.length, REQUESTS)
  t.is(new Set(requests.map(({ socket }) => socket)).size, 1)
  t.deepEqual(
    [...new Set(requests.map(({ socketListeners }) => socketListeners))],
    [requests[0].socketListeners]
  )
  for (const { peaks } of requests) {
    for (const [event, peak] of Object.entries(peaks)) {
      t.true(
        peak < EventEmitter.defaultMaxListeners,
        `${peak} ${event} listeners on one response`
      )
    }
  }
}

const respondWith = (sender, headers) => (req, res) => {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  sender(res, 200, Readable.from([BODY]))
}

for (const [name, sender] of [
  ['send', send],
  ['sendStream', sendStream]
]) {
  for (const [label, headers] of [
    ['detecting', {}],
    ['with content-type', CONTENT_TYPE]
  ]) {
    test(`${name}(200, <Stream>) ${label} does not leak listeners`, async t => {
      const { url, requests } = await runTrackedServer(
        t,
        respondWith(sender, headers)
      )
      await requestSequentially(url)
      assertNoLeak(t, requests)
    })
  }
}

for (const [label, headers] of [
  ['detecting', {}],
  ['with content-type', CONTENT_TYPE]
]) {
  test(`proxy(<Stream>) ${label} does not leak listeners`, async t => {
    const upstream = await runServer(t, (req, res) => {
      res.writeHead(200, headers)
      res.end(BODY)
    })
    const { url, requests } = await runTrackedServer(t, (req, res) =>
      proxy(res, got.stream(upstream, { retry: 0 }))
    )
    await requestSequentially(url)
    assertNoLeak(t, requests)
  })
}
