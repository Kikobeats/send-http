'use strict'

const { setTimeout: delay } = require('timers/promises')
const { default: listen } = require('async-listen')
const { createServer } = require('http')
const { Readable } = require('stream')
const { promisify } = require('util')
const test = require('ava').default
const { once } = require('events')
const got = require('got')

const send = require('..')
const { proxy, sendStream } = send

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

// unlike `failingStream`, it does not wait to be read: `proxy` never reads a
// source that has not answered yet.
const failingUpstream = () => {
  const stream = new Readable({ read () {} })
  process.nextTick(() => stream.destroy(new Error('stream failed')))
  return stream
}

const failingMidwayStream = () => {
  let sent = false
  return new Readable({
    read () {
      if (sent) return this.destroy(new Error('stream failed'))
      sent = true
      this.push('partial')
    }
  })
}

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

// `events.once` rejects on `error`, and these streams close after failing.
const onClose = stream => new Promise(resolve => stream.once('close', resolve))

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

for (const [name, sender] of senders) {
  test(`${name}(200, <Stream>) destroys the response when the stream fails`, async t => {
    const url = await runServer(t, (req, res) =>
      sender(res, 200, failingStream())
    )

    await t.throwsAsync(got(url, { retry: 0 }), { code: 'ECONNRESET' })
  })

  test(`${name}(200, <Stream>) destroys the response when the stream fails midway`, async t => {
    const url = await runServer(t, (req, res) =>
      sender(res, 200, failingMidwayStream())
    )

    await t.throwsAsync(got(url, { retry: 0 }), { code: 'ECONNRESET' })
  })

  test(`${name}(200, <Stream>) destroys the stream when the client goes away`, async t => {
    t.timeout(5000)

    const { promise: sent, resolve: onSent } = Promise.withResolvers()

    const url = await runServer(t, (req, res) => {
      const stream = ongoingStream()
      t.teardown(() => stream.destroy())
      onSent(stream)
      sender(res, 200, stream)
    })

    const request = got.stream(url, { retry: 0 })
    request.once('data', () => request.destroy())
    request.once('error', () => {})

    const stream = await sent
    await onClose(stream)

    t.true(stream.destroyed)
  })
}

test('send(200, <Stream>) forwards the options to sendStream', async t => {
  const url = await runServer(t, (req, res) =>
    send(res, 200, failingStream(), {
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
  t.plan(1)
  const url = await runServer(t, (req, res) => {
    t.is(sendStream(res, 200, Readable.from(['woot'])), res)
  })
  await got(url)
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

const runProxy = async (t, upstreamUrl, options) => {
  const url = await runServer(t, (req, res) =>
    proxy(res, got.stream(upstreamUrl, { retry: 0 }), options)
  )
  const request = got.stream(url, { retry: 0 })
  request.once('error', () => {})
  return request
}

const ALLOWED = { headers: ['content-type'] }

test('proxy(<Stream>) copies only the allowed headers', async t => {
  const upstream = await runServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'x-secret': 'nope' })
    res.end('woot')
  })

  const request = await runProxy(t, upstream, ALLOWED)
  const [response] = await once(request, 'response')

  t.is(response.headers['content-type'], 'text/plain')
  t.is(response.headers['x-secret'], undefined)
})

test('proxy(<Stream>) keeps the upstream status code', async t => {
  const upstream = await runServer(t, (req, res) => {
    res.writeHead(206, { 'content-type': 'text/plain' })
    res.end('woot')
  })

  const request = await runProxy(t, upstream, ALLOWED)
  const [response] = await once(request, 'response')

  t.is(response.statusCode, 206)
})

test('proxy(<Stream>) forwards the first chunk instead of buffering a detection sample', async t => {
  const upstream = await runServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.write(Buffer.alloc(64, 7))
  })

  const request = await runProxy(t, upstream, ALLOWED)
  const [chunk] = await once(request, 'data')
  request.destroy()

  t.is(chunk.length, 64)
})

test('proxy(<Stream>) detects content-type when the upstream omits it', async t => {
  const upstream = await runServer(t, (req, res) => res.end(JPEG))

  const request = await runProxy(t, upstream, ALLOWED)
  const [response] = await once(request, 'response')

  t.is(response.headers['content-type'], 'image/jpeg')
})

test('proxy(<Stream>) destroys the upstream when the client goes away', async t => {
  let upstreamClosed

  const upstream = await runServer(t, (req, res) => {
    upstreamClosed = onClose(res)
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.write(Buffer.alloc(64, 7))
  })

  const request = await runProxy(t, upstream, ALLOWED)
  request.once('data', () => request.destroy())

  await upstreamClosed
  t.pass()
})

test('proxy(<Stream>) destroys the upstream when the client goes away before it responds', async t => {
  let upstreamClosed
  const { promise: upstreamRequested, resolve: onRequested } =
    Promise.withResolvers()

  const upstream = await runServer(t, (req, res) => {
    upstreamClosed = onClose(res)
    onRequested()
  })

  const request = await runProxy(t, upstream, ALLOWED)

  await upstreamRequested
  request.destroy()

  await upstreamClosed
  t.pass()
})

test('proxy(<Stream>) destroys the upstream when the response is already closed', async t => {
  const upstream = await runServer(t, (req, res) =>
    t.fail(`the upstream was reached: ${req.url}`)
  )

  const url = await runServer(t, (req, res) => {
    res.destroy()
    res.once('close', () =>
      proxy(res, got.stream(upstream, { retry: 0 }), ALLOWED)
    )
  })

  await t.throwsAsync(got(url, { retry: 0 }))
  await delay(500)
  t.pass()
})

test('proxy(<Stream>) onError can answer before the headers are sent', async t => {
  const url = await runServer(t, (req, res) =>
    proxy(res, failingUpstream(), {
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

test('sendStream(200, <Stream>) destroys the stream when the response is already closed', async t => {
  const stream = ongoingStream()
  const closed = onClose(stream)

  const url = await runServer(t, (req, res) => {
    res.destroy()
    res.once('close', () => sendStream(res, 200, stream))
  })

  await t.throwsAsync(got(url, { retry: 0 }))
  await closed

  t.true(stream.destroyed)
})
