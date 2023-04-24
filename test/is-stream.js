'use strict'

const Stream = require('node:stream')
const path = require('path')
const test = require('ava')
const net = require('net')
const fs = require('fs')

const { isStream } = require('..')

test('true', t => {
  t.true(isStream(new Stream.Stream()))
  t.true(isStream(new Stream.Readable()))
  t.true(isStream(new Stream.Writable()))
  t.true(isStream(new Stream.Duplex()))
  t.true(isStream(new Stream.Transform()))
  t.true(isStream(new Stream.PassThrough()))
  t.true(isStream(fs.createReadStream(path.resolve(__dirname, 'index.js'))))
  t.true(isStream(new net.Socket()))
})

test('false', t => {
  t.false(isStream(0))
  t.false(isStream(-0))
  t.false(isStream(NaN))
  t.false(isStream(0n))
  t.false(isStream(Symbol('foo')))
  t.false(isStream({}))
  t.false(isStream(null))
  t.false(isStream(false))
  t.false(isStream(undefined))
  t.false(isStream(''))
})
