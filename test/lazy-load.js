'use strict'

const { execFileSync } = require('child_process')
const { once } = require('events')
const { PassThrough, Readable } = require('stream')
const test = require('ava').default
const path = require('path')

const PACKAGE_PATH = path.join(__dirname, '..')
const SNIFFER = '@kikobeats/set-content-type'

const exec = source =>
  JSON.parse(
    execFileSync(process.execPath, ['-e', source], {
      encoding: 'utf8',
      timeout: 5000
    })
  )

// Report on a later turn, then exit. Streams left open (a proxy that has not
// answered) would otherwise hold the process, and `process.exit` before the
// write flushes drops the report when stdout is a pipe.
const modulesAfter = script =>
  exec(`const send = require(${JSON.stringify(PACKAGE_PATH)})
${script}
setImmediate(() => {
  process.stdout.write(
    JSON.stringify(Object.keys(require.cache)) + '\\n',
    () => process.exit(0)
  )
})`)

const hasFileType = modules =>
  modules.some(file => file.includes(`${path.sep}file-type${path.sep}`))

const valueSend = body => `
  const res = {
    headers: {},
    setHeader (name, value) { this.headers[name] = value },
    hasHeader (name) { return name in this.headers },
    end () { this.writableEnded = true }
  }
  ${body}
`

// Real streams, so `pipeline` can write. Header methods are patched on
// because a bare PassThrough has none.
const responseProgram = `
  const { PassThrough, Readable } = require('stream')
  const response = () => {
    const res = new PassThrough()
    res.headers = {}
    res.setHeader = function (name, value) {
      this.headers[name.toLowerCase()] = value
    }
    res.hasHeader = function (name) {
      return this.headers[name.toLowerCase()] !== undefined
    }
    res.getHeader = function (name) {
      return this.headers[name.toLowerCase()]
    }
    res.headersSent = false
    res.resume()
    return res
  }
`

const streamSend = ({ contentType, ended, closed, headersSent } = {}) => `
  ${responseProgram}
  const res = response()
  res.headersSent = ${headersSent ? 'true' : 'false'}
  ${contentType ? "res.setHeader('content-type', 'text/plain')" : ''}
  ${ended ? "Object.defineProperty(res, 'writableEnded', { value: true })" : ''}
  ${closed ? "Object.defineProperty(res, 'closed', { value: true })" : ''}
  send(res, 200, Readable.from([Buffer.from('hello')]))
`

const proxySend = ({ contentType, wait, later, headers } = {}) => {
  const upstreamHeaders = JSON.stringify(
    contentType ? { 'content-type': 'text/plain' } : {}
  )
  const options =
    headers === undefined ? '' : `, { headers: ${JSON.stringify(headers)} }`
  let proxyCall
  if (later) {
    proxyCall = `send.proxy(res, upstream${options})
  upstream.statusCode = 200
  upstream.headers = ${upstreamHeaders}
  upstream.emit('response', upstream)`
  } else if (wait) {
    proxyCall = `send.proxy(res, upstream${options})`
  } else {
    proxyCall = `upstream.statusCode = 200
  upstream.headers = ${upstreamHeaders}
  send.proxy(res, upstream${options})`
  }
  const upstream = later
    ? 'new Readable({ read () {} })'
    : "Readable.from([Buffer.from('hello')])"

  return `
  ${responseProgram}
  const res = response()
  const upstream = ${upstream}
  ${proxyCall}
`
}

test('require does not load file-type', t => {
  t.false(hasFileType(modulesAfter('')))
})

test('sending a string does not load file-type', t => {
  t.false(hasFileType(modulesAfter(valueSend("send(res, 200, 'hello')"))))
})

test('sending a buffer does not load file-type', t => {
  t.false(
    hasFileType(modulesAfter(valueSend("send(res, 200, Buffer.from('hello'))")))
  )
})

test('sending an object does not load file-type', t => {
  t.false(hasFileType(modulesAfter(valueSend('send(res, 200, { ok: true })'))))
})

test('sending nothing does not load file-type', t => {
  t.false(hasFileType(modulesAfter(valueSend('send(res, 200)'))))
})

test('sniffing a stream loads file-type', t => {
  t.true(hasFileType(modulesAfter(streamSend())))
})

test('a stream with a content-type does not load file-type', t => {
  t.false(hasFileType(modulesAfter(streamSend({ contentType: true }))))
})

test('a stream does not load file-type once headers are sent', t => {
  t.false(hasFileType(modulesAfter(streamSend({ headersSent: true }))))
})

test('a stream into an ended response does not load file-type', t => {
  t.false(hasFileType(modulesAfter(streamSend({ ended: true }))))
})

test('a stream into a closed response does not load file-type', t => {
  t.false(hasFileType(modulesAfter(streamSend({ closed: true }))))
})

test('proxying an untyped response loads file-type', t => {
  t.true(hasFileType(modulesAfter(proxySend())))
})

test('proxying a typed response does not load file-type', t => {
  t.false(hasFileType(modulesAfter(proxySend({ contentType: true }))))
})

test('proxy does not load file-type before the upstream responds', t => {
  t.false(hasFileType(modulesAfter(proxySend({ wait: true }))))
})

test('proxy loads file-type when a later response omits it', t => {
  t.true(hasFileType(modulesAfter(proxySend({ later: true }))))
})

test('proxy keeps file-type unloaded when a later response sets it', t => {
  t.false(
    hasFileType(modulesAfter(proxySend({ later: true, contentType: true })))
  )
})

test('proxy sniffs when the allowlist drops content-type', t => {
  t.true(
    hasFileType(modulesAfter(proxySend({ contentType: true, headers: [] })))
  )
})

test('a second sniffed stream reuses the sniffer', t => {
  const { loads } = exec(`
    const Module = require('module')
    const send = require(${JSON.stringify(PACKAGE_PATH)})
    ${responseProgram}
    const body = () => Readable.from([Buffer.from('hello')])
    send(response(), 200, body())
    const original = Module.prototype.require
    let loads = 0
    Module.prototype.require = function (request) {
      if (request === ${JSON.stringify(SNIFFER)}) loads++
      return original.apply(this, arguments)
    }
    send(response(), 200, body())
    process.stdout.write(JSON.stringify({ loads }) + '\\n', () => process.exit(0))
  `)

  t.is(loads, 0)
})

const response = () => {
  const res = new PassThrough()
  res.setHeader = () => {}
  res.hasHeader = () => false
  res.getHeader = () => undefined
  res.headersSent = false
  res.resume()
  return res
}

test('a sniffer that fails to load destroys the source', async t => {
  const Module = require('module')
  const send = require('..')
  const original = Module.prototype.require
  const open = []
  const track = stream => {
    open.push(stream)
    return stream
  }

  Module.prototype.require = function (request) {
    if (request === SNIFFER) throw new Error('sniffer unavailable')
    return original.apply(this, arguments)
  }
  t.teardown(() => {
    Module.prototype.require = original
    for (const stream of open) {
      if (!stream.destroyed) stream.destroy()
    }
  })

  const stream = track(Readable.from([Buffer.from('hello')]))
  const res = track(response())
  const streamFailed = once(stream, 'error')
  let reported
  t.is(
    send(res, 200, stream, {
      onError (error) {
        reported = error
      }
    }),
    res
  )
  t.true(stream.destroyed)
  t.is((await streamFailed)[0], reported)
  t.is(reported.message, 'sniffer unavailable')

  const bare = track(Readable.from([Buffer.from('hello')]))
  const bareRes = track(response())
  const bareFailed = once(bare, 'error')
  t.is(send(bareRes, 200, bare), bareRes)
  t.true(bare.destroyed)
  t.is((await bareFailed)[0].message, 'sniffer unavailable')

  const upstream = track(Readable.from([Buffer.from('hello')]))
  upstream.statusCode = 200
  upstream.headers = {}
  const proxied = track(response())
  const proxyFailed = once(upstream, 'error')
  let proxyError
  t.is(
    send.proxy(proxied, upstream, {
      onError (error) {
        proxyError = error
      }
    }),
    proxied
  )
  t.true(upstream.destroyed)
  t.is((await proxyFailed)[0], proxyError)
  t.is(proxyError.message, 'sniffer unavailable')

  // The other `onceResponse` branch: the throw used to escape the listener.
  const deferred = track(new Readable({ read () {} }))
  const deferredRes = track(response())
  const deferredFailed = once(deferred, 'error')
  let deferredError
  send.proxy(deferredRes, deferred, {
    onError (error) {
      deferredError = error
    }
  })
  t.is(deferredError, undefined)
  deferred.statusCode = 200
  deferred.headers = {}
  t.notThrows(() => deferred.emit('response', deferred))
  t.true(deferred.destroyed)
  t.is((await deferredFailed)[0], deferredError)
  t.is(deferredError.message, 'sniffer unavailable')

  // A failed load must not stick: the next sniff has to try again.
  t.false(hasFileType(Object.keys(require.cache)))
  Module.prototype.require = original
  const again = track(Readable.from([Buffer.from('hello')]))
  const againRes = track(response())
  let againError
  t.is(
    send(againRes, 200, again, {
      onError (error) {
        againError = error
      }
    }),
    againRes
  )
  t.is(againError, undefined)
  t.false(again.destroyed)
  t.true(hasFileType(Object.keys(require.cache)))
})
