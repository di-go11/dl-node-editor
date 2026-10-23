import type { Capabilities } from '../../entity/capabilities/capabilities'

import type { ApiResult } from './api-result'

/**
 * 使えるデバイスの取得(契約の GET /capabilities)。
 *
 * ポート(インターフェース)を application 層に置き、HTTP の実装は infrastructure 層に置く。
 * 画面はこの型だけを知り、本物の API かモックかを知らない(依存性の逆転)。
 * どちらを使うかは、コンポジションルート(main.tsx)だけが決める。
 */
export type CapabilitiesApi = {
  getCapabilities(): Promise<ApiResult<Capabilities>>
}
