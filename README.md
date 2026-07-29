# send-http

![Last version](https://img.shields.io/github/tag/Kikobeats/send-http.svg?style=flat-square)
[![Coverage Status](https://img.shields.io/coveralls/Kikobeats/send-http.svg?style=flat-square)](https://coveralls.io/github/Kikobeats/send-http)
[![NPM Status](https://img.shields.io/npm/dm/send-http.svg?style=flat-square)](https://www.npmjs.org/package/send-http)

> A straightforward way to send data for http.IncomingMessage.

It's like `res.send`, but:

- It accepts any kind of value (number, string, object, stream, etc).
- It checks http.IncomingMessage is writable before write.
- It determines `Content-Type` based on the data type.
- It optionally sets status code as third argument.
- It tears down both ends when a stream fails or the client disconnects.
- It's small (~50 LOC).

## Install

```bash
$ npm install send-http --save
```

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

When a stream fails, the response is destroyed with the error: the failure reaches the client instead of the process. Use `sendStream` to decide what the client gets instead:

```js
const { sendStream } = require('send-http')

http.createServer((req, res) => {
  sendStream(res, 200, got.stream('https://example.com'), {
    onError: (error, res) => {
      if (res.headersSent) return res.destroy(error)
      res.statusCode = 504
      res.end()
    }
  })
})
```

The `Content-Type` is detected from the first bytes of the stream via [@kikobeats/set-content-type](https://github.com/Kikobeats/set-content-type), so a proxied body keeps the type of whatever produced it. An already set `Content-Type` is respected, and an unrecognized payload leaves it unset.

`onError` runs on the stream, before the response is torn down, so it can still write a reply. Once the headers are on the wire nothing can be written, and destroying is the only way to stop a partial body from looking like a complete one.

Additionally, you can `.create` to customize the behvaior before sending the data:

```js
const send = require('send-http').create((res, data) => {
  if (Buffer.byteLength(data) > 6291456) {
    throw new Error('Payload size is over 6mb')
  }
  return res.end(data)
})
```

## License

**send-http** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/send-http/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/Kikobeats/send-http/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/Kikobeats) · X [@Kikobeats](https://x.com/Kikobeats)
