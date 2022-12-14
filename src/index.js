'use strict'

const { isFinished } = require('on-finished')

const isStream = data => !!data && typeof data.pipe === 'function'

const setContentType = (res, type) =>
  !res.hasHeader('Content-Type') && res.setHeader('Content-Type', type)

module.exports = (res, statusCode = 200, data = null) => {
  if (isFinished(res)) return

  res.statusCode = statusCode

  if (data === null) return res.end()

  if (Buffer.isBuffer(data)) {
    setContentType(res, 'application/octet-stream')
    res.setHeader('Content-Length', data.length)
    return res.end(data)
  }

  if (isStream(data)) {
    setContentType(res, 'application/octet-stream')
    return data.pipe(res)
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

  return res.end(str)
}
