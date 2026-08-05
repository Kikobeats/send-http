'use strict'

const { default: listen } = require('async-listen')
const { createServer, get: httpGet } = require('http')
const { Readable } = require('stream')
const { gzipSync } = require('zlib')
const test = require('ava').default
const { once } = require('events')
const got = require('got')

const send = require('..')
const { create, proxy, sendStream } = send

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

const CHUNK = Buffer.alloc(64, 7)

// answers with a chunk and stays open, so the client is reading when it leaves.
const writeChunk = (req, res) => {
  res.writeHead(200, { 'content-type': 'application/octet-stream' })
  res.write(CHUNK)
}

// `asyncDispose` waits for the server to close, but not for keep-alive sockets.
const closeServer = server => {
  server.closeAllConnections()
  return server[Symbol.asyncDispose]()
}

// `events.once` rejects on `error`, and these streams close after failing.
const onClose = stream => new Promise(resolve => stream.once('close', resolve))

// these requests are destroyed on purpose, so the abort is not a failure.
const openRequest = url => {
  const request = got.stream(url, { retry: 0 })
  request.once('error', () => {})
  return request
}

// the upstream outlives the test that closed its server.
const openUpstream = (url, onResponse) =>
  httpGet(url, onResponse).once('error', () => {})

const answeredStream = () =>
  Object.assign(Readable.from(['woot']), { statusCode: 200, headers: {} })

const GZIP_PAYLOAD = Buffer.alloc(1200, 65)
const GZIP_BODY = gzipSync(GZIP_PAYLOAD)

const runGzipServer = (t, head = {}) =>
  runServer(t, (req, res) => {
    res.writeHead(head.statusCode ?? 200, {
      'content-type': 'text/plain',
      'content-encoding': 'gzip',
      'content-length': GZIP_BODY.length,
      ...head.headers
    })
    res.end(GZIP_BODY)
  })

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

const JSON_TYPE = 'application/json; charset=utf-8'

const BUFFERED = [
  ['String', 'woot', 'woot', 'text/plain; charset=utf-8'],
  ['Object', { a: 'b' }, '{"a":"b"}', JSON_TYPE],
  ['Number', 2, '2', JSON_TYPE],
  ['Buffer', Buffer.from('muscle'), 'muscle', 'application/octet-stream']
]

for (const [name, data, expected, type] of BUFFERED) {
  test(`send(200, <${name}>)`, async t => {
    const url = await runServer(t, (req, res) => send(res, 200, data))
    const { body, headers, statusCode } = await got(url)

    t.is(statusCode, 200)
    t.is(body, expected)
    t.is(headers['content-type'], type)
  })

  test(`create()(200, <${name}>) hands the body to the hook`, async t => {
    const hooked = create((res, payload) => {
      t.true(Buffer.isBuffer(payload))
      t.is(payload.toString(), expected)
      return res.end(payload)
    })

    const url = await runServer(t, (req, res) => hooked(res, 200, data))
    const { body } = await got(url)

    t.is(body, expected)
  })
}

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

    const request = openRequest(url)
    request.once('data', () => request.destroy())

    const stream = await sent
    await onClose(stream)

    t.true(stream.destroyed)
  })

  test(`${name}(200, <Stream>) destroys the stream when the response is already closed`, async t => {
    const stream = ongoingStream()
    const closed = onClose(stream)

    const url = await runServer(t, (req, res) => {
      res.destroy()
      res.once('close', () => sender(res, 200, stream))
    })

    await t.throwsAsync(got(url, { retry: 0 }))
    await closed

    t.true(stream.destroyed)
  })

  test(`${name}(200, <Stream>) onError can answer before the headers are sent`, async t => {
    const url = await runServer(t, (req, res) =>
      sender(res, 200, failingStream(), {
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
  t.plan(1)
  const url = await runServer(t, (req, res) => {
    t.is(sendStream(res, 200, Readable.from(['woot'])), res)
  })
  await got(url)
})

test('send(200, <String>) leaves an already answered response alone', async t => {
  const url = await runServer(t, (req, res) => {
    send(res, 200, 'woot')
    t.is(send(res, 502, { error: 'too late' }), res)
  })
  const { body, statusCode } = await got(url, { throwHttpErrors: false })

  t.is(statusCode, 200)
  t.is(body, 'woot')
})

test('send() inside onError cannot answer once the body started', async t => {
  const url = await runServer(t, (req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    sendStream(res, 200, failingMidwayStream(), {
      onError: (error, res) => send(res, 502, { error: error.message })
    })
  })

  await t.throwsAsync(got(url, { retry: 0 }), { code: 'ECONNRESET' })
})

test('create()(200, <Buffer>) hook can refuse the body', async t => {
  const hooked = create((res, payload) =>
    payload.length > 8 ? send(res, 413, 'too large') : res.end(payload)
  )

  const url = await runServer(t, (req, res) =>
    hooked(res, 200, Buffer.alloc(16))
  )
  const { body, statusCode } = await got(url, { throwHttpErrors: false })

  t.is(statusCode, 413)
  t.is(body, 'too large')
})

const runProxy = async (t, upstreamUrl, options) => {
  const url = await runServer(t, (req, res) =>
    proxy(res, got.stream(upstreamUrl, { retry: 0 }), options)
  )
  return openRequest(url)
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

test('proxy(<Stream>) copies the headers that describe the body by default', async t => {
  const described = {
    'accept-ranges': 'bytes',
    'content-disposition': 'attachment; filename="woot.txt"',
    'content-type': 'text/plain'
  }

  const upstream = await runServer(t, (req, res) => {
    res.writeHead(200, {
      ...described,
      'content-length': '4',
      'x-secret': 'nope'
    })
    res.end('woot')
  })

  const request = await runProxy(t, upstream)
  const [response] = await once(request, 'response')

  for (const [header, value] of Object.entries(described)) {
    t.is(response.headers[header], value, `"${header}" should have been copied`)
  }
  t.is(response.headers['content-length'], undefined)
  t.is(response.headers['x-secret'], undefined)
})

test('proxy(<Stream>) copies nothing when the allowlist is empty', async t => {
  const upstream = await runServer(t, (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/plain',
      'accept-ranges': 'bytes'
    })
    res.end(JPEG)
  })

  const request = await runProxy(t, upstream, { headers: [] })
  const [response] = await once(request, 'response')

  t.is(response.headers['accept-ranges'], undefined)
  // nothing said what the body is, so it goes back to being sniffed
  t.is(response.headers['content-type'], 'image/jpeg')
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

test('proxy(<Stream>) copies content-range with a 206 by default', async t => {
  const upstream = await runServer(t, (req, res) => {
    res.writeHead(206, {
      'accept-ranges': 'bytes',
      'content-length': 4,
      'content-range': 'bytes 0-3/10',
      'content-type': 'text/plain'
    })
    res.end('woot')
  })

  const request = await runProxy(t, upstream)
  const [response] = await once(request, 'response')

  t.is(response.statusCode, 206)
  t.is(response.headers['content-range'], 'bytes 0-3/10')
  t.is(response.headers['accept-ranges'], 'bytes')
})

test('proxy(<IncomingMessage>) pipes a response that already answered', async t => {
  const upstream = await runServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': 4 })
    res.end('woot')
  })

  const url = await runServer(t, (req, res) => {
    openUpstream(upstream, upstreamRes => proxy(res, upstreamRes))
  })
  const { body, headers, statusCode } = await got(url)

  t.is(statusCode, 200)
  t.is(body, 'woot')
  t.is(headers['content-type'], 'text/plain')
})

const RELAYING = [
  ['<IncomingMessage>', (res, url) => openUpstream(url, up => proxy(res, up))],
  [
    '<Stream>, { decoded: false }',
    (res, url) =>
      proxy(res, got.stream(url, { decompress: false, retry: 0 }), {
        decoded: false
      })
  ]
]

for (const [shape, relay] of RELAYING) {
  test(`proxy(${shape}) relays the encoding with the bytes`, async t => {
    const upstream = await runGzipServer(t)

    const url = await runServer(t, (req, res) => relay(res, upstream))
    const { body, headers } = await got(url)

    t.is(headers['content-encoding'], 'gzip')
    t.is(headers['content-length'], undefined)
    t.is(body, GZIP_PAYLOAD.toString())
  })
}

test('proxy(<IncomingMessage>) destroys the upstream when the response already answered', async t => {
  const upstream = answeredStream()

  const url = await runServer(t, (req, res) => {
    res.writeHead(204)
    res.end()
    proxy(res, upstream)
  })
  const { body, statusCode } = await got(url)

  t.is(statusCode, 204)
  t.is(body, '')
  t.true(upstream.destroyed)
})

test('proxy(<Stream>) drops the encoding an upstream decoded away', async t => {
  const upstream = await runGzipServer(t)

  const request = await runProxy(t, upstream)
  const [response] = await once(request, 'response')
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)

  t.is(response.headers['content-encoding'], undefined)
  t.is(response.headers['content-length'], undefined)
  t.is(Buffer.concat(chunks).toString(), GZIP_PAYLOAD.toString())
})

test('proxy(<Stream>) drops a content-range the decoding voided', async t => {
  const upstream = await runGzipServer(t, {
    statusCode: 206,
    headers: {
      'accept-ranges': 'bytes',
      'content-range': `bytes 0-${GZIP_BODY.length - 1}/${GZIP_BODY.length}`
    }
  })

  const request = await runProxy(t, upstream)
  const [response] = await once(request, 'response')
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)

  // the range counted the compressed representation, so it names bytes the
  // client never sees once got hands over the decoded ones.
  t.is(response.statusCode, 206)
  t.is(response.headers['content-range'], undefined)
  t.is(response.headers['accept-ranges'], 'bytes')
  t.is(Buffer.concat(chunks).toString(), GZIP_PAYLOAD.toString())
})

test('proxy(<Stream>) streams the full body when upstream content-length is wrong', async t => {
  const body = Buffer.from('this body is longer than the declared length')
  const upstream = Object.assign(Readable.from([body]), {
    statusCode: 200,
    headers: {
      'content-type': 'image/svg+xml',
      'content-length': '10'
    }
  })

  const url = await runServer(t, (req, res) => proxy(res, upstream))
  const { body: received, headers } = await got(url, { responseType: 'buffer' })

  t.is(received.compare(body), 0)
  t.is(headers['content-length'], undefined)
})

test('proxy(<Stream>) forwards the first chunk instead of buffering a detection sample', async t => {
  const upstream = await runServer(t, writeChunk)

  const request = await runProxy(t, upstream, ALLOWED)
  const [chunk] = await once(request, 'data')
  request.destroy()

  t.is(chunk.length, CHUNK.length)
})

test('proxy(<Stream>) detects content-type when the upstream omits it', async t => {
  const upstream = await runServer(t, (req, res) => res.end(JPEG))

  const request = await runProxy(t, upstream, ALLOWED)
  const [response] = await once(request, 'response')

  t.is(response.headers['content-type'], 'image/jpeg')
})

test('proxy(<Stream>) destroys the upstream when the client goes away', async t => {
  let upstreamRes
  // resolving with a promise adopts it, so this settles on the upstream close.
  const { promise: upstreamClosed, resolve: settleOnClose } =
    Promise.withResolvers()

  const upstream = await runServer(t, (req, res) => {
    upstreamRes = res
    writeChunk(req, res)
    settleOnClose(onClose(res))
  })

  const request = await runProxy(t, upstream, ALLOWED)
  request.once('data', () => request.destroy())

  await upstreamClosed

  t.true(upstreamRes.destroyed)
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
  const upstream = ongoingStream()
  const closed = onClose(upstream)

  const url = await runServer(t, (req, res) => {
    res.destroy()
    res.once('close', () => proxy(res, upstream, ALLOWED))
  })

  await t.throwsAsync(got(url, { retry: 0 }))
  await closed

  t.true(upstream.destroyed)
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
