'use strict'

const sniffContentType = require('@kikobeats/set-content-type')
const { PassThrough, pipeline } = require('node:stream')

const noop = () => {}

const isStream = input => typeof input?.pipe === 'function'

const hasContentType = res =>
  res.headersSent || res.getHeader('content-type') !== undefined

const setContentType = (res, type) => {
  if (!hasContentType(res)) res.setHeader('content-type', type)
}

/** Closes a response nobody answered, without the error: an upstream that fails
 * before saying anything is not a failure of the response itself. */
const destroyUnanswered = res => {
  if (!res.headersSent && !res.writableEnded) res.destroy()
}

/** Registered on the stream rather than through `pipeline`, which by its
 * callback has already destroyed the response. */
const forwardErrors = (stream, res, onError) =>
  stream.once('error', error => {
    if (onError) onError(error, res)
    destroyUnanswered(res)
  })

const pipeStream = (res, statusCode, stream) => {
  // piping into a gone response throws; the stream still has to go somewhere.
  if (res.closed || res.writableEnded) {
    stream.destroy()
    return res
  }

  res.statusCode = statusCode
  // never `stream` straight into `res`: piping a request stream into a
  // `ServerResponse` copies its headers over, past the allowlist.
  hasContentType(res)
    ? pipeline(stream, new PassThrough(), res, noop)
    : pipeline(stream, sniffContentType(res), noop)
  return res
}

const sendStream = (res, statusCode, stream, { onError } = {}) => {
  forwardErrors(stream, res, onError)
  return pipeStream(res, statusCode, stream)
}

const proxy = (res, upstream, { headers = [], onError } = {}) => {
  // piping only guards from the moment it starts, which is a response away.
  if (res.closed) upstream.destroy()
  else res.once('close', () => upstream.destroy())

  forwardErrors(upstream, res, onError)

  upstream.once('response', upstreamRes => {
    for (const header of headers) {
      const value = upstreamRes.headers[header]
      if (value) res.setHeader(header, value)
    }
    // piped once the headers landed: an upstream content-type makes sniffing the
    // payload, and the sample it withholds, unnecessary.
    pipeStream(res, upstreamRes.statusCode, upstream)
  })

  return res
}

const create =
  send =>
    (res, statusCode = 200, data = null, options) => {
      if (isStream(data)) return sendStream(res, statusCode, data, options)

      res.statusCode = statusCode

      if (data === null) return res.end()

      if (Buffer.isBuffer(data)) {
        setContentType(res, 'application/octet-stream')
        res.setHeader('content-length', data.length)
        return res.end(data)
      }

      const type = typeof data
      const isJSON = type === 'object' || type === 'number' || type === 'boolean'
      const str = isJSON ? JSON.stringify(data) : data

      setContentType(
        res,
        isJSON ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
      )
      res.setHeader('content-length', Buffer.byteLength(str))

      return send(res, str)
    }

module.exports = create((res, data) => res.end(data))
module.exports.create = create
module.exports.isStream = isStream
module.exports.proxy = proxy
module.exports.sendStream = sendStream
