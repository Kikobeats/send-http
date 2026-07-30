'use strict'

const sniffContentType = require('@kikobeats/set-content-type')
const { PassThrough, pipeline } = require('node:stream')

const noop = () => {}

const isStream = input => typeof input?.pipe === 'function'

const hasContentType = res => res.headersSent || res.hasHeader('content-type')

const setContentType = (res, type) => {
  if (!hasContentType(res)) res.setHeader('content-type', type)
}

/** Headers on the wire cannot be set again, and an ended response takes no
 * body: past either point there is no reply left to make. */
const canAnswer = res => !res.headersSent && !res.writableEnded

/** Registered on the stream rather than through `pipeline`, which by its
 * callback has already destroyed the response. A response nobody answered is
 * closed without the error: an upstream that fails before saying anything is
 * not a failure of the response itself. */
const forwardErrors = (stream, res, onError) =>
  stream.once('error', error => {
    if (onError) onError(error, res)
    if (canAnswer(res)) res.destroy()
  })

const pipeStream = (res, statusCode, stream) => {
  // piping into a gone response throws; the stream still has to go somewhere.
  if (res.closed || res.writableEnded) {
    stream.destroy()
    return res
  }

  res.statusCode = statusCode
  // never `stream` straight into `res`: piping a request stream into a
  // `ServerResponse` copies its headers over, past the allowlist. With nothing
  // to detect the hop is our own, not the sniffer's: it nests a second
  // pipeline, and skipping it is worth ~13% on a 64KB body.
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

/** Declares what the body is and hands it over as bytes: a string measured,
 * then written, then encoded is three walks of the same payload. */
const serialize = (res, data) => {
  if (Buffer.isBuffer(data)) {
    setContentType(res, 'application/octet-stream')
    return data
  }

  const isJSON = typeof data !== 'string'

  setContentType(
    res,
    isJSON ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
  )

  return Buffer.from(isJSON ? JSON.stringify(data) : data)
}

const create =
  send =>
    (res, statusCode = 200, data = null, options) => {
      if (isStream(data)) return sendStream(res, statusCode, data, options)
      if (!canAnswer(res)) return res

      res.statusCode = statusCode

      if (data === null) return res.end()

      const payload = serialize(res, data)
      res.setHeader('content-length', payload.length)

      return send(res, payload)
    }

module.exports = create((res, data) => res.end(data))
module.exports.create = create
module.exports.isStream = isStream
module.exports.proxy = proxy
module.exports.sendStream = sendStream
