'use strict'

const { promisify } = require('util')
const { once } = require('events')
const http = require('http')
const test = require('ava')
const got = require('got')

const send = require('..')

const listenServer = async (server, ...args) => {
  server.listen(...args)
  await once(server, 'listening')
  const { address, port } = server.address()
  return `http://${address === '::' ? '[::]' : address}:${port}`
}

const getServer = async (t, handler) => {
  const server = http.createServer(handler)
  const url = await listenServer(server)
  t.teardown(promisify(server.close.bind(server)))
  return url
}

test('send(200, <null>)', async t => {
  const url = await getServer(t, (req, res) => send(res, 200, null))
  const { body, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, '')
})

test('send(200, <String>)', async t => {
  const url = await getServer(t, (req, res) => send(res, 200, 'woot'))
  const { body, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, 'woot')
})

test('send(200, <Object>)', async t => {
  const url = await getServer(t, (req, res) => send(res, 200, { a: 'b' }))
  const { body, statusCode } = await got(url, { responseType: 'json' })

  t.is(statusCode, 200)
  t.deepEqual(body, { a: 'b' })
})

test('send(200, <Number>)', async t => {
  const url = await getServer(t, (req, res) => send(res, 200, 2))
  const { body, statusCode } = await got(url, { responseType: 'json' })

  t.is(statusCode, 200)
  t.is(body, 2)
})

test('send(200, <Buffer>)', async t => {
  const url = await getServer(t, (req, res) =>
    send(res, 200, Buffer.from('muscle'))
  )
  const { body, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, 'muscle')
})

test('send(200, <Stream>)', async t => {
  const streamUrl = await getServer(t, (req, res) => {
    res.end('OK')
  })
  const url = await getServer(t, (req, res) =>
    send(res, 200, got.stream(streamUrl))
  )
  const { body, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, 'OK')
})
