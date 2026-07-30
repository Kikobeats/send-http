'use strict'

const sniffContentType = require('@kikobeats/set-content-type')
const { PassThrough, pipeline } = require('node:stream')

const noop = () => {}

const isStream = input => typeof input?.pipe === 'function'

/** Mirrors the guard `@kikobeats/set-content-type` applies to itself: the two
 * have to agree on when the type is still open, or the sniffer gets asked for
 * something it will refuse to do. */
const canSetContentType = res =>
  !res.headersSent && !res.hasHeader('content-type')

const setContentType = (res, type) => {
  if (canSetContentType(res)) res.setHeader('content-type', type)
}

const canAnswer = res => !res.headersSent && !res.writableEnded

/** Registered on the stream rather than through `pipeline`, which by its
 * callback has already destroyed the response. */
const forwardErrors = (stream, res, onError) =>
  stream.once('error', error => {
    onError?.(error, res)
    if (canAnswer(res)) res.destroy()
  })

const pipeStream = (res, statusCode, stream) => {
  // piping into a gone response throws; the stream still has to go somewhere.
  if (res.closed || res.writableEnded) {
    stream.destroy()
    return res
  }

  res.statusCode = statusCode
  if (canSetContentType(res)) {
    pipeline(stream, sniffContentType(res), noop)
  } else {
    // the sniffer would hand back this same hop, wrapped in a second pipeline:
    // ~13% on a 64KB body. Never `stream` straight into `res` though, since
    // piping a request stream into a `ServerResponse` copies its headers over.
    pipeline(stream, new PassThrough(), res, noop)
  }
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

/** Declares the body on the response and hands it over as bytes: a string
 * measured, then written, then encoded is three walks of the same payload. */
const declareBody = (res, data) => {
  let payload = data

  if (Buffer.isBuffer(data)) {
    setContentType(res, 'application/octet-stream')
  } else {
    const isJSON = typeof data !== 'string'

    setContentType(
      res,
      isJSON ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
    )
    payload = Buffer.from(isJSON ? JSON.stringify(data) : data)
  }

  res.setHeader('content-length', payload.length)
  return payload
}

const create =
  send =>
    (res, statusCode = 200, data = null, options) => {
      if (isStream(data)) return sendStream(res, statusCode, data, options)
      if (!canAnswer(res)) return res

      res.statusCode = statusCode

      if (data === null) return res.end()

      return send(res, declareBody(res, data))
    }

module.exports = create((res, data) => res.end(data))
module.exports.create = create
module.exports.isStream = isStream
module.exports.proxy = proxy
module.exports.sendStream = sendStream
