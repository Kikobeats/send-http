'use strict'

const { execFileSync } = require('child_process')
const test = require('ava').default
const path = require('path')

const PACKAGE_PATH = path.join(__dirname, '..')

const loadedModules = script =>
  JSON.parse(
    execFileSync(process.execPath, [
      '-e',
      `const send = require(${JSON.stringify(PACKAGE_PATH)})
      ${script}
      const report = () => console.log(JSON.stringify(Object.keys(require.cache)))
      setImmediate(report)`
    ])
  )

const hasFileType = modules =>
  modules.some(file => file.includes(`${path.sep}file-type${path.sep}`))

test('require does not load file-type', t => {
  t.false(hasFileType(loadedModules('')))
})

test('sending a value does not load file-type', t => {
  const script = `
    const res = {
      headers: {},
      setHeader (name, value) { this.headers[name] = value },
      hasHeader (name) { return name in this.headers },
      end () { this.writableEnded = true }
    }
    send(res, 200, 'hello')`
  t.false(hasFileType(loadedModules(script)))
})

test('sniffing a stream loads file-type', t => {
  const script = `
    const { PassThrough, Readable } = require('stream')
    const res = new PassThrough()
    res.setHeader = () => {}
    res.hasHeader = () => false
    res.getHeader = () => undefined
    res.resume()
    send(res, 200, Readable.from([Buffer.from('hello')]))`
  t.true(hasFileType(loadedModules(script)))
})
