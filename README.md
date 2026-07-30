# send-http

![Last version](https://img.shields.io/github/tag/Kikobeats/send-http.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/send-http.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/send-http)
[![NPM Status](https://img.shields.io/npm/dm/send-http.svg?style=flat-square)](https://www.npmjs.org/package/send-http)

> A straightforward way to send data for http.IncomingMessage.

It's like `res.send`, but:

- It accepts any kind of value (number, string, object, stream, etc).
- It checks http.IncomingMessage is writable before write.
- It determines `Content-Type` from the data: the type for values, the first bytes for streams.
- It optionally sets status code as third argument.
- It tears down both ends when a stream fails or the client disconnects.
- It proxies an HTTP response with `proxy`, keeping the upstream status and the headers you allow.
- It's small (~80 LOC).

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

`onError` runs on the stream, before the response is torn down, so it can still write a reply. Write one and the response is left alone; write nothing and it is closed for you.

`send` takes the same options as a fourth argument and forwards them when the body is a stream, so `send(res, 200, stream, { onError })` is `sendStream(res, 200, stream, { onError })`.

### proxy

Relaying an HTTP response is not the same as sending a stream: the status and the headers belong to the upstream, and they only exist once it answers.

```js
const { proxy } = require('send-http')

http.createServer((req, res) => {
  proxy(res, got.stream('https://example.com/video.mp4'), {
    headers: ['content-type', 'content-length', 'accept-ranges'],
    onError: (error, res) => send(res, 502, { error: error.message })
  })
})
```

`headers` is an allowlist of lowercase names copied from the upstream response; nothing else crosses. The upstream status code is the one the client gets, so a `206` stays a `206`.

Piping waits for the upstream response, which is what makes the allowlist worth having: a forwarded `Content-Type` means the payload is never sampled, and the first byte reaches the client as soon as the upstream produces it.

The upstream dies with the client in every window: while streaming, while still waiting for the upstream to answer, and when the client had already gone before `proxy` was ever called.

### create

Customizes the write of a buffered body (streams go through `sendStream`). The hook runs after the `Content-Type` and `Content-Length` are set, and receives the body as a `Buffer` whatever it was given:

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

## License

**send-http** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/send-http/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/Kikobeats/send-http/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
