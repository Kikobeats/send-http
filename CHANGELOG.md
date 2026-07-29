# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## 2.0.0 (2026-07-29)


### ⚠ BREAKING CHANGES

* engines moves from node >= 18 to node >= 24, required by
file-type via @kikobeats/set-content-type. send-http also stops being
dependency free, and a streamed body no longer defaults to
application/octet-stream: an unrecognized payload now has no content-type.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FCxsnS9h1VeVbsvUuyDyGU

* test: keep the abort tests ahead of the detection sample

The client-abort tests dribbled five byte chunks, which the content-type
sample holds back, so the client never received the byte it aborts on and
the test timed out instead of exercising the teardown.

Also raises the floor to 1.0.6, the release that detects across chunk
boundaries; ~1.0.3 still allowed the version that only read the first one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FCxsnS9h1VeVbsvUuyDyGU

* refactor: skip the sniffer when the content-type is already set

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RKFc8LpHGgBgK7TL2EhGMv

* refactor: drop the redundant content-type guard and fold the duplicated stream tests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RKFc8LpHGgBgK7TL2EhGMv

* refactor: let sendStream own the status code and cover both senders midway

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RKFc8LpHGgBgK7TL2EhGMv

* refactor: assert the sendStream return value in place

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RKFc8LpHGgBgK7TL2EhGMv

* refactor: destructure sendStream from the single require

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RKFc8LpHGgBgK7TL2EhGMv

### Features

* add sendStream ([#20](https://github.com/Kikobeats/send-http/issues/20)) ([6bd4944](https://github.com/Kikobeats/send-http/commit/6bd4944672805125ce2f1470d52621ef6e2f7558))

### 1.0.7 (2026-07-28)

### 1.0.6 (2023-10-23)

### 1.0.5 (2023-09-07)

### 1.0.4 (2023-04-24)

### 1.0.3 (2023-03-28)

### 1.0.2 (2023-02-05)

### 1.0.1 (2023-01-22)

## [1.0.0](https://github.com/Kikobeats/send-http/compare/v0.0.1...v1.0.0) (2022-12-01)

### 0.0.1 (2022-12-01)
