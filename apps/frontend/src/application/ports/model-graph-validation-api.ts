import type { ModelGraph } from '../../entity/model-graph/model-graph'
import type { ValidationResult } from '../../entity/validation/issue'

import type { ApiResult } from './api-result'

/**
 * サーバー側の整合性チェック(契約の POST /model-graphs/validate。指示書 8 章 (3))。
 *
 * どの演算を本当に実行できるかを知っているのは C++ 側なので、学習を始める前に
 * サーバーにも確かめる。フロント側のチェック(エンティティ層)と結果を同じ Issue の型で
 * 受け取り、ログに並べて出す。
 *
 * 「検証が行われ、結果が NG だった」は成功(ok: true の ApiResult の中の ok: false)であり、
 * 通信の失敗(ApiResult の ok: false)とは区別する(契約の説明のとおり)。
 */
export type ModelGraphValidationApi = {
  validate(graph: ModelGraph): Promise<ApiResult<ValidationResult>>
}
