# send-http

![Last version](https://img.shields.io/github/tag/Kikobeats/send-http.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/send-http.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/send-http)
[![NPM Status](https://img.shields.io/npm/dm/send-http.svg?style=flat-square)](https://www.npmjs.org/package/send-http)

> A straightforward way to send data for http.ServerResponse.

It's like `res.send`, but:

- It accepts any kind of value (number, string, object, stream, etc).
- It leaves a response that already answered alone, rather than throwing at you.
- It determines `Content-Type` from the data: the type for values, the first bytes for streams.
- It optionally sets the status code as second argument.
- It tears down both ends when a stream fails or the client disconnects.
- It proxies an HTTP response with `proxy`, keeping the upstream status and the headers that describe the body.
- It's small (~110 LOC, one dependency).

## Install

```bash
$ npm install send-http --save
```

It requires Node.js >= 24.

## Usage

```js
const send = require('send-http')
const http = require('http')
const got = require('got')

http.createServer((req, res) => {
  /* send with no body */
  send(res, 200)

  /* send a string */
  send(res, 200, 'foo')

  /* send an object */
  send(res, 200, { foo: 'bar' })

  /* send a number */
  send(res, 200, 1234)

  /* send a buffer */
  send(res, 200, Buffer.from('hello world'))

  /* send a stream  */
  send(res, 200, got.stream('https.//example.com'))
})
```

When the body is a stream, the `Content-Type` is detected from its first bytes via [@kikobeats/set-content-type](https://github.com/Kikobeats/set-content-type). An already set `Content-Type` is respected, and an unrecognized payload leaves it unset. `proxy` is different: when upstream sends `Content-Type` and it crosses the allowlist, that value is forwarded and the body is not sampled.

When a stream fails before anything reached the client, the response is closed without the error: an upstream that never answered is not a failure of the response itself. Once bytes are on the wire they cannot be retracted, so the response is destroyed with the failure and the client sees a reset rather than a truncated body that looks complete.

Use `sendStream` to decide what the client gets instead:

```js
const { sendStream } = require('send-http')

http.createServer((req, res) => {
  sendStream(res, 200, got.stream('https://example.com'), {
    onError: (error, res) => {
      res.statusCode = error.code === 'ETIMEDOUT' ? 504 : 502
      res.end()
    }
  })
})
```

`onError` runs on the stream, before the response is torn down, so it can still write a reply. Write one and the response is left alone; write nothing and it is closed for you. Once the headers are out there is nothing left to answer with: `send` returns the response untouched rather than throwing `ERR_HTTP_HEADERS_SENT` at you from inside a listener, and the client sees the failure as a reset.

`send` takes the same options as a fourth argument and forwards them when the body is a stream, so `send(res, 200, stream, { onError })` is `sendStream(res, 200, stream, { onError })`.

### proxy

Relaying an HTTP response is not the same as sending a stream: status and body-descriptor headers come from the upstream once it answers.

```js
const { proxy } = require('send-http')

http.createServer((req, res) => {
  proxy(res, got.stream('https://example.com/video.mp4'), {
    onError: (error, res) => send(res, 502, { error: error.message })
  })
})
```

`onError` follows the same rules as `sendStream` above.

`headers` is an allowlist of lowercase names that may cross; nothing else does. It defaults to `STREAM_ALLOWED_HEADERS`:

```js
const { STREAM_ALLOWED_HEADERS } = require('send-http')

proxy(res, upstream, { headers: [...STREAM_ALLOWED_HEADERS, 'etag'] })
```

`content-length` is not in the default list: upstreams often declare a wrong length while still sending the full body, so the proxied response uses chunked transfer instead.

`proxy` accepts either a stream that emits `response` later, or an `IncomingMessage` that already answered:

```js
proxy(res, got.stream(url))
http.get(url, upstream => proxy(res, upstream))
```

`got.stream` decompresses by default. When the body was decoded on the way in, `content-encoding` and `content-range` from that hop are dropped so they do not mislabel the bytes being piped. Pass `{ decoded: false }` to relay the compressed representation instead (same as piping an `IncomingMessage`).

When `content-type` crosses, the first byte reaches the client as soon as the upstream produces it. If it does not cross, `Content-Type` is sniffed from the first bytes like `sendStream`.

Teardown matches streams (see above): the upstream is destroyed when the client leaves, including before the upstream has answered.

### create

Customizes the write of a buffered body (streams go through `sendStream`, and an empty body ends the response without a write to customize). The hook runs after the `Content-Type` and `Content-Length` are set, and receives the body as a `Buffer` whatever it was given:

```js
const send = require('send-http').create((res, data) => {
  if (data.length > 6291456) {
    throw new Error('Payload size is over 6mb')
  }
  return res.end(data)
})
```

### isStream

The predicate behind the dispatch, exported for reusing the same rule:

```js
const { isStream } = require('send-http')

isStream(got.stream('https://example.com')) // => true
isStream({}) // => false
```

### canAnswer

The guard behind the no-op: `false` once the headers went out or the response ended, which is when writing to it would throw. Use it to skip work whose only purpose was the answer:

```js
const { canAnswer } = require('send-http')

if (canAnswer(res)) send(res, 500, { error: 'upstream failed' })
```

`send` already checks it, so an unconditional call is safe too: it returns the response untouched rather than throwing.

## License

**send-http** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/send-http/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/Kikobeats/send-http/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
