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
  it('契約の JSON を、エンティティの型に変換して返す(種類と番号は id から読む)', async () => {
    const result = await api().getCapabilities()
    expect(result).toEqual({
      ok: true,
      value: {
        cudaAvailable: true,
        devices: [
          { name: 'cpu', index: 0, type: 'cpu' },
          { name: 'cuda:0', index: 0, type: 'cuda' },
        ],
      },
    })
  })

  it('GPU がなければ cudaAvailable は false、読めない id は unspecified', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/capabilities`, () =>
        HttpResponse.json({
          devices: [
            { id: 'cpu', name: 'cpu' },
            { id: 'npu:1', name: 'npu' },
          ],
        }),
      ),
    )
    expect(await api().getCapabilities()).toEqual({
      ok: true,
      value: {
        cudaAvailable: false,
        devices: [
          { name: 'cpu', index: 0, type: 'cpu' },
          { name: 'npu', index: 0, type: 'unspecified' },
        ],
      },
    })
  })

  it('cuda の番号を id から読む', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/capabilities`, () =>
        HttpResponse.json({ devices: [{ id: 'cuda:2', name: 'cuda:2' }] }),
      ),
    )
    expect(await api().getCapabilities()).toEqual({
      ok: true,
      value: { cudaAvailable: true, devices: [{ name: 'cuda:2', index: 2, type: 'cuda' }] },
    })
  })

  it('502(学習エンジンに届かない)なら、本文が空でも状態コードから説明を作る', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/capabilities`, () => new HttpResponse(null, { status: 502 })),
    )
    expect(await api().getCapabilities()).toEqual({
      ok: false,
      error: { kind: 'http', status: 502, message: '学習サーバーに接続できません。' },
    })
  })

  it('エラーの本文は読まない', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/capabilities`, () => new HttpResponse('oops', { status: 500 })),
    )
    const result = await api().getCapabilities()
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 500 } })
  })

  it('応答が契約の形をしていなければ invalid-response', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/capabilities`, () => HttpResponse.json({ devices: 'none' })),
    )
    const result = await api().getCapabilities()
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-response' } })
    if (!result.ok) expect(result.error.message).toContain('devices')
  })

  it('通信そのものが失敗したら network', async () => {
    server.use(http.get(`${TEST_BASE_URL}/capabilities`, () => HttpResponse.error()))
    const result = await api().getCapabilities()
    expect(result).toMatchObject({ ok: false, error: { kind: 'network' } })
  })
})
