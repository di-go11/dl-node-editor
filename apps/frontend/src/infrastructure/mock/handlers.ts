import { HttpResponse, http } from 'msw'

import type { components } from '../../api/schema'
import { modelGraphJsonSchema } from '../../entity/model-graph/proto-json/schema'
import { startTrainingRequestJsonSchema } from '../../entity/training/proto-json/schema'
import { API_BASE_PATH } from '../http/api-client'

/**
 * MSW(Mock Service Worker)のリクエストハンドラ - モック API(指示書 6.3)。
 *
 * MSW は、ブラウザでは Service Worker、Node(テスト)ではリクエストの横取りによって、
 * fetch が実際にネットワークへ出る手前で応答を差し込む。アプリのコードから見ると
 * 本物の API と区別がつかないので、本物につなぎ替えるときにアプリ側を変えずに済む。
 * 同じハンドラをブラウザ(browser.ts)とテスト(server.ts)の両方で使う。
 *
 * 応答には生成型(components['schemas'])で型を付けている。モックが契約からずれると
 * tsc が教えてくれるので、「モックでは動くのに本物では動かない」を防げる。
 *
 * ## リクエストも検証する
 *
 * 受け取った JSON は、エンティティ層の Zod スキーマ(C++ が読む形)で確かめ、
 * 形が違えば本物と同じく 400 を返す。モックが何でも受け付けると、送る JSON の誤りに
 * 本物につないだ瞬間まで気づけないためである。
 *
 * 進捗(SSE)と停止はフェーズ 6 で足す。
 */

type Schemas = components['schemas']

/** モックが返す既定のデバイス一覧(CPU と GPU 1 枚) */
export const MOCK_CAPABILITIES: Schemas['CapabilitiesResponse'] = {
  cuda_available: true,
  devices: [
    { device_name: 'CPU', device_index: 0, device_type: 'DEVICE_TYPE_CPU' },
    {
      device_name: 'Mock GPU (NVIDIA GeForce RTX 4070)',
      device_index: 0,
      device_type: 'DEVICE_TYPE_CUDA',
    },
  ],
}

export type MockOptions = {
  /**
   * ベース URL。ブラウザでは相対パス(既定値)、テストでは絶対 URL を渡す
   * (Node には「今のページ」がないため、相対パスを解決できない)。
   */
  readonly baseUrl?: string
  readonly capabilities?: Schemas['CapabilitiesResponse']
  /** サーバー側のチェックの結果(既定は問題なし) */
  readonly validateResponse?: Schemas['ValidateModelGraphResponse']
}

/** 本物と同じ形の 400 の応答を作る */
function badRequest(message: string, issues: Schemas['Issue'][]) {
  const body: Schemas['ErrorResponse'] = {
    error: { code: 'INVALID_ARGUMENT', message, issues },
  }
  return HttpResponse.json(body, { status: 400 })
}

/** Zod の検証エラーを、契約の Issue の形にする */
function zodIssuesToJson(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): Schemas['Issue'][] {
  return issues.map((issue) => ({
    severity: 'error',
    message: `${issue.path.map(String).join('.')}: ${issue.message}`,
  }))
}

export function createHandlers(options: MockOptions = {}) {
  const base = options.baseUrl ?? API_BASE_PATH
  const capabilities = options.capabilities ?? MOCK_CAPABILITIES
  const validateResponse = options.validateResponse ?? { ok: true, issues: [] }
  let jobCount = 0

  return [
    http.get(`${base}/capabilities`, () => HttpResponse.json(capabilities)),

    http.post(`${base}/model-graphs/validate`, async ({ request }) => {
      const body: unknown = await request.json()
      const modelGraph =
        typeof body === 'object' && body !== null && 'model_graph' in body
          ? body.model_graph
          : undefined
      const parsed = modelGraphJsonSchema.safeParse(modelGraph)
      if (!parsed.success) {
        return badRequest(
          'model_graph の形が正しくありません',
          zodIssuesToJson(parsed.error.issues),
        )
      }
      return HttpResponse.json(validateResponse)
    }),

    http.post(`${base}/trainings`, async ({ request }) => {
      const parsed = startTrainingRequestJsonSchema.safeParse(await request.json())
      if (!parsed.success) {
        return badRequest(
          '学習開始のリクエストの形が正しくありません',
          zodIssuesToJson(parsed.error.issues),
        )
      }
      jobCount += 1
      const response: Schemas['StartTrainingResponse'] = {
        job_id: `mock-job-${jobCount}`,
        status: 'TRAINING_STATUS_RUNNING',
      }
      // 学習は非同期に始まるので 202 Accepted(契約のとおり)
      return HttpResponse.json(response, { status: 202 })
    }),
  ]
}
