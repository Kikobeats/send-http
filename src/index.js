'use strict'

const sniffContentType = require('@kikobeats/set-content-type')
const { pipeline } = require('node:stream')

const isStream = input => input != null && typeof input.pipe === 'function'

const setContentType = (res, type) =>
  !res.hasHeader('Content-Type') && res.setHeader('Content-Type', type)

const sendStream = (res, statusCode, stream, { onError } = {}) => {
  res.statusCode = statusCode
  // onError runs on the stream, not on the pipeline callback: by the time
  // pipeline calls back it already destroyed res, so no reply can be written.
  if (onError !== undefined) stream.once('error', error => onError(error, res))
  // sniffContentType(res) already forwards to res, so it is the destination.
  pipeline(stream, sniffContentType(res), () => {})
  return res
}

const create =
  send =>
    (res, statusCode = 200, data = null) => {
      res.statusCode = statusCode

      if (data === null) return res.end()

      if (Buffer.isBuffer(data)) {
        setContentType(res, 'application/octet-stream')
        res.setHeader('Content-Length', data.length)
        return res.end(data)
      }

      if (isStream(data)) return sendStream(res, statusCode, data)

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
module.exports.sendStream = sendStream
