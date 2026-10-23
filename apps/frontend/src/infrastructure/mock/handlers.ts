import { HttpResponse, http } from 'msw'

import type { components } from '../../api/schema'
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
 * 今はフェーズ 2 で使う /capabilities だけ。ほかのエンドポイントは、使うフェーズで足す。
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
}

export function createHandlers(options: MockOptions = {}) {
  const base = options.baseUrl ?? API_BASE_PATH
  const capabilities = options.capabilities ?? MOCK_CAPABILITIES

  return [http.get(`${base}/capabilities`, () => HttpResponse.json(capabilities))]
}
