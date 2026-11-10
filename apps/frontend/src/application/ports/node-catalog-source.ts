import type { NodeCatalog } from '../../entity/node-catalog/catalog'

import type { ApiResult } from './api-result'

/**
 * ノードカタログの取得元(指示書 5.3)。
 *
 * どの演算を使えるかを本当に知っているのは C++ 側である。今はフロントの固定データ
 * (infrastructure/catalog)を返すが、将来は API から取得する実装に差し替える。
 * そのとき画面側を一切変えずに済むよう、ここではインターフェースだけを決める。
 *
 * 固定データでも非同期(Promise)にしているのは、API に替えたとき
 * 呼び出し側の書き方を変えずに済むようにするためである。
 */
export type NodeCatalogSource = {
  load(): Promise<ApiResult<NodeCatalog>>
}
