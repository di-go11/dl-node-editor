// @vitest-environment node
import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import { MOCK_DATASETS } from '../mock/handlers'
import { TEST_BASE_URL, createMockServer } from '../mock/server'

import { createApiClient } from './api-client'
import { createHttpDatasetApi } from './http-dataset-api'
import { createHttpTrainingApi } from './http-training-api'

/**
 * データセット一覧の HTTP 実装と、学習開始でのデータセットの指定を、MSW のモック API に対して確かめる。
 */

const server = createMockServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const client = () => createApiClient(TEST_BASE_URL)

describe('createHttpDatasetApi', () => {
  it('一覧は JSON をエンティティの形にする(パスは含まれない)', async () => {
    const result = await createHttpDatasetApi(client()).list()

    expect(result).toEqual({
      ok: true,
      value: MOCK_DATASETS.map((dataset) => ({
        datasetId: dataset.dataset_id,
        name: dataset.dataset_name,
        type: dataset.dataset_type,
        createdAt: dataset.created_at,
      })),
    })
  })

  it('0 件なら空の一覧を返す', async () => {
    server.use(http.get(`${TEST_BASE_URL}/datasets`, () => HttpResponse.json({ datasets: [] })))
    expect(await createHttpDatasetApi(client()).list()).toEqual({ ok: true, value: [] })
  })

  it('エラーの状態コードは kind: http にする', async () => {
    server.use(http.get(`${TEST_BASE_URL}/datasets`, () => new HttpResponse(null, { status: 500 })))
    expect(await createHttpDatasetApi(client()).list()).toMatchObject({
      ok: false,
      error: { kind: 'http', status: 500 },
    })
  })

  it('契約の形をしていない応答は invalid-response にする', async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/datasets`, () =>
        HttpResponse.json({ datasets: [{ dataset_id: '' }] }),
      ),
    )
    expect(await createHttpDatasetApi(client()).list()).toMatchObject({
      ok: false,
      error: { kind: 'invalid-response' },
    })
  })
})

describe('アップロード', () => {
  const zip = () => new Blob(['zip-bytes'], { type: 'application/zip' })

  it('zip・名前・形式を multipart で送ると登録され、一覧に載る', async () => {
    const api = createHttpDatasetApi(client())
    const result = await api.upload({
      file: zip(),
      fileName: 'uploaded.zip',
      name: 'uploaded-voc',
      type: 'pascal_voc',
    })
    expect(result).toEqual({ ok: true, value: null })

    const list = await api.list()
    if (!list.ok) throw new Error(list.error.message)
    expect(list.value.map((dataset) => dataset.name)).toContain('uploaded-voc')
  })

  it('名前が空なら、本物と同じく 400 になり、足りない項目の説明を返す', async () => {
    const result = await createHttpDatasetApi(client()).upload({
      file: zip(),
      fileName: 'x.zip',
      name: '',
      type: 'pascal_voc',
    })
    expect(result).toEqual({
      ok: false,
      error: { kind: 'http', status: 400, message: 'zip・名前・形式のどれかが足りません。' },
    })
  })

  it('413 は、ファイルが大きすぎるという説明にする', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/datasets/upload`, () => new HttpResponse(null, { status: 413 })),
    )
    const result = await createHttpDatasetApi(client()).upload({
      file: zip(),
      fileName: 'big.zip',
      name: 'big',
      type: 'pascal_voc',
    })
    expect(result).toMatchObject({
      ok: false,
      error: { status: 413, message: 'ファイルが大きすぎます(サーバーの受信上限を超えています)。' },
    })
  })

  it('422 は、本文の足りないファイル・フォルダを並べて説明する', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/datasets/upload`, () =>
        HttpResponse.json(
          { format: 'original', missing: ['JPEGImages/', 'labelmap.txt'] },
          { status: 422 },
        ),
      ),
    )
    const result = await createHttpDatasetApi(client()).upload({
      file: zip(),
      fileName: 'voc.zip',
      name: 'voc',
      type: 'original',
    })
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'http',
        status: 422,
        message:
          'zip の中身が「Original(labelmap.txt)」形式のフォルダ構成になっていません。足りないもの: JPEGImages/、labelmap.txt',
      },
    })
  })

  it('422 の本文が契約の形でなければ、状態コードの説明にする', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/datasets/upload`, () => new HttpResponse(null, { status: 422 })),
    )
    const result = await createHttpDatasetApi(client()).upload({
      file: zip(),
      fileName: 'voc.zip',
      name: 'voc',
      type: 'pascal_voc',
    })
    expect(result).toMatchObject({
      ok: false,
      error: { status: 422, message: 'zip の中身が、選んだ形式のフォルダ構成になっていません。' },
    })
  })
})

describe('学習開始のデータセットの指定', () => {
  const settings = (datasetId: string) => ({
    ...defaultTrainingSettings(),
    modelName: `dataset_${datasetId.replace(/[^A-Za-z0-9_-]/g, '_') || 'empty'}`,
    datasetId,
    device: 'cpu',
  })

  it('登録済みのデータセットの ID を送ると、学習を始められる', async () => {
    const id = MOCK_DATASETS[0]?.dataset_id ?? ''
    const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings(id))
    expect(result.ok).toBe(true)
  })

  it('一覧にない ID は、本物と同じく 422 になる', async () => {
    const result = await createHttpTrainingApi(client()).start(
      validSegnetGraph(),
      settings('deleted-dataset'),
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 422 } })
  })

  it('未選択(空の ID)なら、送らずに失敗する', async () => {
    let called = false
    server.use(
      http.post(`${TEST_BASE_URL}/trainings`, () => {
        called = true
        return new HttpResponse(null, { status: 500 })
      }),
    )
    const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings(''))
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-request' } })
    expect(called).toBe(false)
  })
})
