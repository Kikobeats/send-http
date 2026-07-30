'use strict'

const sniffContentType = require('@kikobeats/set-content-type')
const { pipeline, finished } = require('node:stream')

const isStream = input => input != null && typeof input.pipe === 'function'

const setContentType = (res, type) =>
  !res.hasHeader('Content-Type') && res.setHeader('Content-Type', type)

/** Closes a response nobody answered, without the error: an upstream that fails
 * before saying anything is not a failure of the response itself. */
const destroyUnanswered = res => {
  if (!res.headersSent && !res.writableEnded) res.destroy()
}

/** Runs `onError` while a reply still fits, then closes whatever it left open.
 * Registered on the stream rather than through `pipeline`, which by its callback
 * has already destroyed the response. */
const forwardErrors = (stream, res, onError) =>
  stream.once('error', error => {
    if (onError) onError(error, res)
    destroyUnanswered(res)
  })

const sendStream = (res, statusCode, stream, { onError } = {}) => {
  // piping into a gone response throws; the stream still has to go somewhere.
  if (res.closed || res.writableEnded) {
    stream.destroy()
    return res
  }

  res.statusCode = statusCode
  forwardErrors(stream, res, onError)
  pipeline(stream, sniffContentType(res), () => {})
  return res
}

/**
 * Relays an HTTP response: the status and the allowed headers are the
 * upstream's, and the upstream dies with the client.
 *
 * @param {http.ServerResponse} res
 * @param {stream.Duplex} upstream a request stream emitting `response`
 * @param {object} [options]
 * @param {string[]} [options.headers] lowercase names to copy from the upstream
 * @param {Function} [options.onError]
 */
const proxy = (res, upstream, { headers = [], onError } = {}) => {
  // `pipeline` only guards from the moment it pipes, which is a response away.
  finished(res, () => upstream.destroy())
  forwardErrors(upstream, res, onError)

  upstream.once('response', upstreamRes => {
    for (const header of headers) {
      const value = upstreamRes.headers[header]
      if (value) res.setHeader(header, value)
    }
    // piped once the headers landed: an upstream content-type makes sniffing the
    // payload, and the sample it withholds, unnecessary.
    sendStream(res, upstreamRes.statusCode, upstream)
  })

  return res
}

const create =
  send =>
    (res, statusCode = 200, data = null) => {
      if (isStream(data)) return sendStream(res, statusCode, data)

      res.statusCode = statusCode

      if (data === null) return res.end()

      if (Buffer.isBuffer(data)) {
        setContentType(res, 'application/octet-stream')
        res.setHeader('Content-Length', data.length)
        return res.end(data)
      }

      let str = data
      const type = typeof data

      if (type === 'object' || type === 'number' || type === 'boolean') {
        str = JSON.stringify(data)
        setContentType(res, 'application/json; charset=utf-8')
      } else {
        setContentType(res, 'text/plain; charset=utf-8')
      }

      res.setHeader('Content-Length', Buffer.byteLength(str))

      return send(res, str)
    }

module.exports = create((res, data) => res.end(data))
module.exports.create = create
module.exports.isStream = isStream
module.exports.proxy = proxy
module.exports.sendStream = sendStream
