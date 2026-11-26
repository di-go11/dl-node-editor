// @vitest-environment node
import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { nodeId } from '../../entity/model-graph/node-id'
import type { ModelGraph } from '../../entity/model-graph/model-graph'
import { toStartTrainingRequestJson } from '../../entity/training/proto-json/convert'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import { defaultVariant } from '../../entity/training/variant'
import { IMAGE_TASK_TYPES } from '../../entity/training/data-spec'
import { validSegnetGraph } from '../../entity/validation/test-fixtures'
import { GRAPH_INPUT, nodeOutput } from '../../entity/model-graph/port'
import { TEST_BASE_URL, createMockServer } from '../mock/server'

import { createApiClient } from './api-client'
import { createHttpTrainingApi } from './http-training-api'
import { toRustStartTrainingRequest } from './rust-training-request'
import { ERROR_CODE_MESSAGES, REQUEST_SHAPE_MESSAGE } from './server-error-code'

/**
 * 学習開始(POST /trainings)の HTTP 実装を、MSW のモック API に対して動かして確かめる。
 *
 * モックはリクエストの JSON を Rust の DTO と同じ形の Zod で検証するので、
 * ここが通れば「送っている JSON が契約の形をしている」ことも同時に確かめられる。
 */

const server = createMockServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const client = () => createApiClient(TEST_BASE_URL)
const settings = { ...defaultTrainingSettings(), datasetId: 'mock-dataset-voc2012', device: 'cpu' }

describe('createHttpTrainingApi', () => {
  it('Rust の形で送り、job_id を受け取る(状態は running に固定する)', async () => {
    const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings)
    expect(result).toEqual({ ok: true, value: { jobId: 'mock-job-1', status: 'running' } })
  })

  it.each([
    [409, 'すでに実行中の学習があります。'],
    [
      422,
      '学習設定またはモデル構造が受け付けられませんでした。選んだデータセットが削除されている場合は、選び直してください。',
    ],
    [404, '指定されたジョブが見つかりません。'],
    [502, '学習サーバーに接続できません。'],
    [500, 'サーバーがエラーを返しました(HTTP 500)。'],
  ])('本文が空の %i の応答は、状態コードから説明を作る', async (status, message) => {
    server.use(http.post(`${TEST_BASE_URL}/trainings`, () => new HttpResponse(null, { status })))
    const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings)
    expect(result).toEqual({ ok: false, error: { kind: 'http', status, message } })
  })

  it('Rust に対応する値がないタスクは、送らずに失敗する', async () => {
    let called = false
    server.use(
      http.post(`${TEST_BASE_URL}/trainings`, () => {
        called = true
        return HttpResponse.json({ job_id: 'x' })
      }),
    )
    const task = defaultVariant(IMAGE_TASK_TYPES, 'object_detection')
    const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), {
      ...settings,
      dataSpec: { ...settings.dataSpec, task },
    })
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-request' } })
    expect(called).toBe(false)
  })

  it('原因のコードのある 422 は、その原因の説明にする', async () => {
    // モックは本物と同じく、登録されていないデータセットに dataset_not_found を返す
    const notFound = await createHttpTrainingApi(client()).start(validSegnetGraph(), {
      ...settings,
      datasetId: 'deleted-dataset',
    })
    expect(notFound).toEqual({
      ok: false,
      error: { kind: 'http', status: 422, message: ERROR_CODE_MESSAGES.dataset_not_found },
    })

    server.use(
      http.post(`${TEST_BASE_URL}/trainings`, () =>
        HttpResponse.json({ error: 'dataset_unreadable' }, { status: 422 }),
      ),
    )
    const unreadable = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings)
    expect(unreadable).toEqual({
      ok: false,
      error: { kind: 'http', status: 422, message: ERROR_CODE_MESSAGES.dataset_unreadable },
    })
  })

  it('設定の誤りの 422 は、違反の一覧を位置付きの issues にしてエラーに付ける', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/trainings`, () =>
        HttpResponse.json(
          {
            error: 'invalid_config',
            violations: [
              { field: 'optimizer.learning_rate', message: '0 より大きくしてください(0)' },
              { field: 'model_graph.nodes[0].spec.stride', message: '1 以上にしてください(0)' },
            ],
          },
          { status: 422 },
        ),
      ),
    )
    const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings)
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 422 } })
    if (result.ok) return
    expect(
      result.error.issues?.map((i) => [i.code, i.field ?? null, i.paramName ?? null]),
    ).toEqual([
      ['training/server-rejected', `optimizer.${settings.optimizer.kind}.learning_rate`, null],
      ['training/server-rejected', null, 'stride'],
    ])
  })
})

describe('createHttpTrainingApi の整合性チェック(POST /trainings/validate)', () => {
  // モックは学習を始めた名前を使用済みとして覚えるので、テストごとに別の名前にする
  const named = (modelName: string) => ({ ...settings, modelName })

  it('204 なら OK', async () => {
    const result = await createHttpTrainingApi(client()).validate(
      validSegnetGraph(),
      named('validate_fresh'),
    )
    expect(result).toEqual({ ok: true, value: { kind: 'ok' } })
  })

  it('409 は通信の失敗ではなく「名前が使用済み」という結果になる', async () => {
    const api = createHttpTrainingApi(client())
    await api.start(validSegnetGraph(), named('validate_used'))
    const result = await api.validate(validSegnetGraph(), named('validate_used'))
    expect(result).toEqual({ ok: true, value: { kind: 'model-name-used' } })
  })

  it('それ以外のエラーの状態コードは http のエラーになる', async () => {
    server.use(
      http.post(
        `${TEST_BASE_URL}/trainings/validate`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    )
    const result = await createHttpTrainingApi(client()).validate(
      validSegnetGraph(),
      named('validate_500'),
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 500 } })
  })

  it('設定・モデル構造の誤りの 422 は、通信の失敗ではなく違反の一覧という結果になる', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/trainings/validate`, () =>
        HttpResponse.json(
          {
            error: 'invalid_config',
            violations: [
              {
                field: 'model_graph.nodes[0]',
                message: "ポート 'y': モデルの出力のチャンネル数(3)が、クラス数(21)と一致しません",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    )
    const graph = validSegnetGraph()
    const input = named('validate_422')
    // サーバーの添字は、送ったリクエストの nodes の添字
    const sent = toRustStartTrainingRequest(toStartTrainingRequestJson(graph, input))
    const firstNodeId = sent.ok ? sent.value.model_graph.nodes[0]?.id : undefined

    const result = await createHttpTrainingApi(client()).validate(graph, input)
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'invalid-config',
        issues: [{ code: 'training/server-rejected', nodeId: firstNodeId, port: 'y' }],
      },
    })
  })

  it('登録されていないデータセットは、通信の失敗ではなく dataset-not-found という結果になる', async () => {
    const result = await createHttpTrainingApi(client()).validate(validSegnetGraph(), {
      ...named('validate_no_dataset'),
      datasetId: 'deleted-dataset',
    })
    expect(result).toEqual({ ok: true, value: { kind: 'dataset-not-found' } })
  })

  it('色表が読めないデータセットは dataset-unreadable という結果になる', async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/trainings/validate`, () =>
        HttpResponse.json({ error: 'dataset_unreadable' }, { status: 422 }),
      ),
    )
    const result = await createHttpTrainingApi(client()).validate(
      validSegnetGraph(),
      named('validate_unreadable'),
    )
    expect(result).toEqual({ ok: true, value: { kind: 'dataset-unreadable' } })
  })

  it('JSON でない本文の 422 は、リクエストの形が合わないという説明のエラーになる', async () => {
    server.use(
      http.post(
        `${TEST_BASE_URL}/trainings/validate`,
        () =>
          new HttpResponse('Failed to deserialize the JSON body into the target type', {
            status: 422,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    )
    const result = await createHttpTrainingApi(client()).validate(
      validSegnetGraph(),
      named('validate_text'),
    )
    expect(result).toEqual({
      ok: false,
      error: { kind: 'http', status: 422, message: REQUEST_SHAPE_MESSAGE },
    })
  })

  it('原因の分からない本文のない 422 は、http のエラーになる(古いサーバーなど)', async () => {
    server.use(
      http.post(
        `${TEST_BASE_URL}/trainings/validate`,
        () => new HttpResponse(null, { status: 422 }),
      ),
    )
    const result = await createHttpTrainingApi(client()).validate(
      validSegnetGraph(),
      named('validate_422_empty'),
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 422 } })
    if (!result.ok) expect(result.error.issues).toBeUndefined()
  })
})

describe('toRustStartTrainingRequest', () => {
  const graph: ModelGraph = {
    nodes: [
      {
        id: nodeId('act'),
        spec: { kind: 'activation', params: { activation_type: 'ACTIVATION_TYPE_RELU', dim: 1 } },
        inputs: [{ port: 'x', source: GRAPH_INPUT }],
      },
      {
        id: nodeId('cat'),
        spec: { kind: 'concat', params: {} },
        inputs: [{ port: 'x', source: nodeOutput(nodeId('act'), 'y') }],
      },
    ],
    outputs: [nodeOutput(nodeId('cat'), 'y')],
  }
  const convert = (patch = {}) =>
    toRustStartTrainingRequest(toStartTrainingRequestJson(graph, { ...settings, ...patch }))

  it('種類は type に、グラフ入力は null に、enum は短い名前にする', () => {
    const result = convert()
    if (!result.ok) throw new Error(result.message)
    expect(result.value.model_graph).toEqual({
      nodes: [
        {
          id: 'act',
          spec: { type: 'activation', activation_type: 'relu', dim: 1 },
          inputs: [{ port: 'x', source: null }],
        },
        {
          id: 'cat',
          spec: { type: 'concat' },
          inputs: [{ port: 'x', source: { node_id: 'act', port: 'y' } }],
        },
      ],
      outputs: [{ node_id: 'cat', port: 'y' }],
    })
    expect(result.value.optimizer.type).toBe('adam')
    expect(result.value.loss).toEqual({ type: 'cross_entropy' })
    expect(result.value.data_spec).toMatchObject({
      type: 'image',
      image_task_spec: {
        type: 'segmentation',
        ignore_index: 255,
        ignore_color_enabled: true,
        ignore_color_r: 224,
        ignore_color_g: 224,
        ignore_color_b: 192,
      },
      image_annotation_config: { type: 'pascal_voc', include_difficult: false },
    })
  })

  it('seed は数値にし、固定しないならキーを省く(0 は「0 に固定する」)', () => {
    expect(convert({ seed: 0 })).toMatchObject({ ok: true, value: { seed: 0 } })
    const unset = convert({ seed: null })
    if (!unset.ok) throw new Error(unset.message)
    expect(unset.value).not.toHaveProperty('seed')
  })

  it('UNSPECIFIED は Rust に対応する値がないので失敗する', () => {
    const json = toStartTrainingRequestJson(graph, settings)
    const result = toRustStartTrainingRequest({
      ...json,
      model_graph: {
        ...json.model_graph,
        nodes: [
          {
            id: 'act',
            spec: { activation: { activation_type: 'ACTIVATION_TYPE_UNSPECIFIED', dim: 1 } },
            inputs: [],
          },
        ],
      },
    })
    expect(result.ok).toBe(false)
  })
})

describe('モックの学習開始', () => {
  it('形の正しくない JSON には、本文なしの 422 を返す(本物と同じ厳しさ)', async () => {
    const response = await fetch(`${TEST_BASE_URL}/trainings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_name: 'x' }),
    })
    expect(response.status).toBe(422)
    expect(await response.text()).toBe('')
  })

  it('学習中の開始は 409 を再現できる', async () => {
    const running = createMockServer({ alreadyRunning: true })
    server.close()
    running.listen({ onUnhandledFrame: 'error' })
    try {
      const result = await createHttpTrainingApi(client()).start(validSegnetGraph(), settings)
      expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 409 } })
    } finally {
      running.close()
      server.listen({ onUnhandledFrame: 'error' })
    }
  })
})
