// @vitest-environment node
import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { TEST_BASE_URL, createMockServer } from '../mock/server'

import { createApiClient } from './api-client'
import { createHttpCapabilitiesApi } from './http-capabilities-api'

/**
 * HTTP 実装を、MSW のモック API に対して動かして確かめる。
 *
 * fetch を関数ごと差し替える(モック関数にする)方法もあるが、それだと
 * openapi-fetch が組み立てる URL やヘッダを検査できない。MSW は通信の手前で
 * 応答を差し込むので、実際のリクエストの組み立てまで含めて確かめられる。
 */

const server = createMockServer()

// onUnhandledFrame: 'error' … ハンドラのないリクエストはテストを失敗させる。
// 呼ぶはずのないパスを呼んでいる誤りを見逃さないため
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const api = () => createHttpCapabilitiesApi(createApiClient(TEST_BASE_URL))

describe('createHttpCapabilitiesApi', () => {
  it('契約の JSON を、エンティティの型に変換して返す', async () => {
    const result = await api().getCapabilities()
    expect(result).toEqual({
      ok: true,
      value: {
        cudaAvailable: true,
        devices: [
          { name: 'CPU', index: 0, type: 'cpu' },
          { name: 'Mock GPU (NVIDIA GeForce RTX 4070)', index: 0, type: 'cuda' },
        ],
      },
    })
  })

  it('502(学習エンジンに届かない)なら、契約の ErrorResponse からメッセージを取り出す', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/capabilities`, () =>
        HttpResponse.json(
          { error: { code: 'UPSTREAM_UNAVAILABLE', message: '学習エンジンに接続できません' } },
          { status: 502 },
        ),
      ),
    )
    expect(await api().getCapabilities()).toEqual({
      ok: false,
      error: {
        kind: 'http',
        status: 502,
        code: 'UPSTREAM_UNAVAILABLE',
        message: '学習エンジンに接続できません',
      },
    })
  })

  it('エラーの本文が契約の形でなくても、状態コードから説明を作る', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/capabilities`, () => new HttpResponse('oops', { status: 500 })),
    )
    const result = await api().getCapabilities()
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 500 } })
  })

  it('応答が契約の形をしていなければ invalid-response', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/capabilities`, () =>
        HttpResponse.json({ cuda_available: 'yes', devices: [] }),
      ),
    )
    const result = await api().getCapabilities()
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-response' } })
    if (!result.ok) expect(result.error.message).toContain('cuda_available')
  })

  it('通信そのものが失敗したら network', async () => {
    server.use(http.get(`${TEST_BASE_URL}/capabilities`, () => HttpResponse.error()))
    const result = await api().getCapabilities()
    expect(result).toMatchObject({ ok: false, error: { kind: 'network' } })
  })
})
