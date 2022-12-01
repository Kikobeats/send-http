# send-http

> A straightforward way to send data for http.IncomingMessage.

It's like `res.send`, but:

- It accepts any kind of value (number, string, object, stream, etc).
- It checks http.IncomingMessage is writable before write.
- It determines `Content-Type` based on the data type.
- It optionally sets status code as third argument.
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

http.createServer().on('request', (req, res) => {
  /* send a string */
  send(200, 'foo')

  /* send an object */
  send(200, { foo: 'bar' })

  /* send a number */
  send(200, 1234)

  /* send a buffer */
  send(200, Buffer.from('hello world'))

  /* send a stream  */
  send(200, got.stream('https.//example.com')) //

  /* send a stream */
  send(200, got.stream('https.//example.com'))

  /* sets status code too */
  send(200, got.stream('https.//example.com'))
})
```

## License

**send-http** © [Kiko Beats](https://kikobeats.com), released under the [MIT](https://github.com/Kikobeats/send-http/blob/master/LICENSE.md) License.<br>
Authored and maintained by [Kiko Beats](https://kikobeats.com) with help from [contributors](https://github.com/Kikobeats/send-http/contributors).

> [kikobeats.com](https://kikobeats.com) · GitHub [Kiko Beats](https://github.com/Kikobeats) · Twitter [@Kikobeats](https://twitter.com/Kikobeats)
