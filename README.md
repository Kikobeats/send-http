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

When the body is a stream, the `Content-Type` is detected from its first bytes via [@kikobeats/set-content-type](https://github.com/Kikobeats/set-content-type), so a proxied body keeps the type of whatever produced it. An already set `Content-Type` is respected, and an unrecognized payload leaves it unset.

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

Relaying an HTTP response is not the same as sending a stream: the status and the headers belong to the upstream, and they only exist once it answers.

```js
const { proxy } = require('send-http')

http.createServer((req, res) => {
  proxy(res, got.stream('https://example.com/video.mp4'), {
    onError: (error, res) => send(res, 502, { error: error.message })
  })
})
```

`headers` is an allowlist of lowercase names that may cross from the upstream response; nothing else does. It defaults to `STREAM_ALLOWED_HEADERS`, the five that describe the body rather than the upstream serving it:

```js
const { STREAM_ALLOWED_HEADERS } = require('send-http')
// => ['accept-ranges', 'content-disposition', 'content-encoding', 'content-range', 'content-type']

proxy(res, upstream, { headers: [...STREAM_ALLOWED_HEADERS, 'etag'] })
```

`content-length` is omitted: upstreams often declare a wrong length while still sending the full body, and streaming cannot verify the value anyway — the proxied response uses chunked transfer instead.

The upstream status code is the one the client gets, so a `206` stays a `206`, and `content-range` crosses with it so range clients can resume.

`proxy` takes either shape of upstream, and neither needs telling which it is:

```js
proxy(res, got.stream(url)) // answers later, on 'response'
http.get(url, upstream => proxy(res, upstream)) // already answered
```

Nothing here compresses or decompresses, so what differs is whether the upstream did. A stream that answers with a response object of its own is describing the hop before whatever it then did to the bytes, and `got.stream` decompresses there by default: the encoding would mislabel the decoded body, so it does not cross.

Piping waits for the upstream response, which is what makes the allowlist worth having: a forwarded `Content-Type` means the payload is never sampled, and the first byte reaches the client as soon as the upstream produces it.

The upstream dies with the client in every window: while streaming, while still waiting for the upstream to answer, and when the client had already gone before `proxy` was ever called.

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
