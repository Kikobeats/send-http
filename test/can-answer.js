'use strict'

const { default: listen } = require('async-listen')
const { createServer } = require('http')
const test = require('ava').default
const got = require('got')

const send = require('..')
const { canAnswer } = send

const closeServer = server =>
  new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  )

/** The states are only reachable on a live `ServerResponse`, so the handler
 * records them and the body carries them back to the assertions. */
const collect = async (t, record) => {
  const states = []
  const server = createServer((req, res) => {
    record(res, () => states.push(canAnswer(res)))
  })
  const url = await listen(server)
  t.teardown(() => closeServer(server))
  await got(url)
  return states
}

test('true before anything is written', async t => {
  const states = await collect(t, (res, snapshot) => {
    snapshot()
    res.end()
  })

  t.deepEqual(states, [true])
})

test('false once the headers are sent', async t => {
  const states = await collect(t, (res, snapshot) => {
    res.writeHead(200)
    snapshot()
    res.end()
  })

  t.deepEqual(states, [false])
})

test('false once the response ended', async t => {
  const states = await collect(t, (res, snapshot) => {
    res.end()
    snapshot()
  })

  t.deepEqual(states, [false])
})

test('false once send answered', async t => {
  const states = await collect(t, (res, snapshot) => {
    send(res, 200, 'hello')
    snapshot()
  })

  t.deepEqual(states, [false])
})

/** `ServerResponse#end` always flushes the headers, so the two clauses only
 * come apart on a response-like wrapper, which is what the export is for. */
test('false when a wrapper ended without flushing headers', t => {
  t.false(canAnswer({ headersSent: false, writableEnded: true }))
  t.true(canAnswer({ headersSent: false, writableEnded: false }))
})

test('true after headers are set but not flushed', async t => {
  const states = await collect(t, (res, snapshot) => {
    res.setHeader('x-custom', 'value')
    snapshot()
    res.end()
  })

  t.deepEqual(states, [true])
})
