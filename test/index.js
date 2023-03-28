'use strict'

const { default: listen } = require('async-listen')
const { createServer } = require('http')
const { promisify } = require('util')
const test = require('ava')
const got = require('got')

const send = require('..')

const closeServer = server => promisify(server.close)

const runServer = async (t, handler) => {
  const server = createServer(handler)
  const url = await listen(server)
  t.teardown(() => closeServer(server))
  return url
}

test('send(200, <null>)', async t => {
  const url = await runServer(t, (req, res) => send(res, 200, null))
  const { body, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, '')
})

test('send(200, <String>)', async t => {
  const url = await runServer(t, (req, res) => send(res, 200, 'woot'))
  const { body, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, 'woot')
})

test('send(200, <Object>)', async t => {
  const url = await runServer(t, (req, res) => send(res, 200, { a: 'b' }))
  const { body, statusCode } = await got(url, { responseType: 'json' })

  t.is(statusCode, 200)
  t.deepEqual(body, { a: 'b' })
})

test('send(200, <Number>)', async t => {
  const url = await runServer(t, (req, res) => send(res, 200, 2))
  const { body, statusCode } = await got(url, { responseType: 'json' })

  t.is(statusCode, 200)
  t.is(body, 2)
})

test('send(200, <Buffer>)', async t => {
  const url = await runServer(t, (req, res) =>
    send(res, 200, Buffer.from('muscle'))
  )
  const { body, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, 'muscle')
})

test('send(200, <Stream>)', async t => {
  const streamUrl = await runServer(t, (req, res) => {
    res.end('OK')
  })
  const url = await runServer(t, (req, res) =>
    send(res, 200, got.stream(streamUrl))
  )
  const { body, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, 'OK')
})
