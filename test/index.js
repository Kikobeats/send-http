'use strict'

const { default: listen } = require('async-listen')
const { createServer } = require('http')
const { Readable } = require('stream')
const { promisify } = require('util')
const test = require('ava').default
const got = require('got')

const send = require('..')
const { sendStream } = require('..')

const senders = [
  ['send', send],
  ['sendStream', sendStream]
]

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

// large enough that content-type detection resolves on the first chunk,
// so the client sees data before the abort tests destroy the request.
const PAST_DETECTION_SAMPLE = Buffer.alloc(8192, 7)

const failingStream = () =>
  new Readable({
    read () {
      this.destroy(new Error('stream failed'))
    }
  })

const ongoingStream = () => {
  let timer
  return new Readable({
    read () {
      timer = setTimeout(() => this.push(PAST_DETECTION_SAMPLE), 10)
    },
    destroy (error, callback) {
      clearTimeout(timer)
      callback(error)
    }
  })
}

const closeServer = server => {
  server.closeAllConnections()
  return promisify(server.close.bind(server))()
}

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

test('send(200, <Stream>) destroys the response when the stream fails midway', async t => {
  const url = await runServer(t, (req, res) => {
    let sent = false
    const stream = new Readable({
      read () {
        if (sent) return this.destroy(new Error('stream failed'))
        sent = true
        this.push('partial')
      }
    })
    send(res, 200, stream)
  })

  await t.throwsAsync(got(url, { retry: 0 }), { code: 'ECONNRESET' })
})

for (const [name, sender] of senders) {
  test(`${name}(200, <Stream>) destroys the response when the stream fails`, async t => {
    const url = await runServer(t, (req, res) =>
      sender(res, 200, failingStream())
    )

    await t.throwsAsync(got(url, { retry: 0 }), { code: 'ECONNRESET' })
  })

  test(`${name}(200, <Stream>) destroys the stream when the client goes away`, async t => {
    t.timeout(5000)

    let streamClosed
    const closed = new Promise(resolve => {
      streamClosed = resolve
    })

    const url = await runServer(t, (req, res) => {
      const stream = ongoingStream()
      t.teardown(() => stream.destroy())
      stream.once('close', () => streamClosed(stream.destroyed))
      sender(res, 200, stream)
    })

    const request = got.stream(url, { retry: 0 })
    request.once('data', () => request.destroy())
    request.once('error', () => {})

    t.true(await closed)
  })
}

test('sendStream(200, <Stream>) detects content-type from the payload', async t => {
  const url = await runServer(t, (req, res) =>
    sendStream(res, 200, Readable.from([JPEG]))
  )
  const { headers } = await got(url)

  t.is(headers['content-type'], 'image/jpeg')
})

test('sendStream(200, <Stream>) keeps an already set content-type', async t => {
  const url = await runServer(t, (req, res) => {
    res.setHeader('content-type', 'image/png')
    sendStream(res, 200, Readable.from([JPEG]))
  })
  const { headers } = await got(url)

  t.is(headers['content-type'], 'image/png')
})

test('sendStream(200, <Stream>) leaves content-type unset when unrecognized', async t => {
  const url = await runServer(t, (req, res) =>
    sendStream(res, 200, Readable.from(['woot']))
  )
  const { body, headers, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, 'woot')
  t.is(headers['content-type'], undefined)
})

test('sendStream(200, <Stream>) returns the response', async t => {
  let returned
  const url = await runServer(t, (req, res) => {
    returned = sendStream(res, 200, Readable.from(['woot'])) === res
  })
  await got(url)

  t.true(returned)
})

test('sendStream(200, <Stream>) onError can answer before the headers are sent', async t => {
  const url = await runServer(t, (req, res) =>
    sendStream(res, 200, failingStream(), {
      onError: (error, res) => {
        t.is(error.message, 'stream failed')
        res.statusCode = 504
        res.end()
      }
    })
  )
  const { statusCode } = await got(url, { retry: 0, throwHttpErrors: false })

  t.is(statusCode, 504)
})
