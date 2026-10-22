import type { ValidationResult } from './issue'
import { sortIssuesBySeverity, toValidationResult } from './issue'
import { validateChannelConsistency } from './rules/channel-consistency'
import { validateInputArity, validatePortKinds } from './rules/connections'
import { validateContextCompat, validateNodeTypes } from './rules/node-types'
import { validateParams } from './rules/params'
import {
  validateAcyclic,
  validateGraphIo,
  validateNodeIds,
  validateReferences,
} from './rules/structure'
import type { ValidationInput, ValidationRule } from './validation-input'

/**
 * モデル構造の整合性チェック(指示書 8 章 (1))。
 *
 * ## 「ルールの配列」として組み立てる理由
 *
 * 1. **1 件目で打ち切らない。** model_graph.proto の冒頭が「見つかった問題は
 *    すべて位置付きで返す」としており、ログに全件出す仕様(4.2)と合っている。
 *    1 つ直すたびに次のエラーが現れる作りだと、修正に何往復も必要になる。
 * 2. **各ルールが独立に単体テストできる。** 入力はただのデータ、出力は Issue[] の
 *    純粋関数なので、グラフを 1 つ作るだけで検査できる。
 * 3. **ルールの追加が配列への 1 行で済む。** 未決事項 1(loss とタスクの
 *    組み合わせ制限)も、フェーズ 5 でルールを 1 つ足すだけになる。
 *
 * ## 並び順
 *
 * 前のルールが「原因」を報告し、後のルールがその「結果」を黙って飛ばす関係にある。
 * 知らない層の種類(node-types)を最初に置き、以降のルールは定義が引けない
 * ノードを飛ばす。こうすると 1 つの原因で Issue が何件も並ぶのを避けられる。
 */
export const MODEL_GRAPH_RULES: readonly ValidationRule[] = [
  // 原因になりやすいものから順に
  validateNodeTypes,
  validateNodeIds,
  validateGraphIo,
  validateReferences,
  validateAcyclic,
  // 構造が分かってから調べるもの
  validateInputArity,
  validatePortKinds,
  validateContextCompat,
  validateParams,
  // 確実でないので warning
  validateChannelConsistency,
]

export function validateModelGraph(input: ValidationInput): ValidationResult {
  const issues = MODEL_GRAPH_RULES.flatMap((rule) => rule(input))
  return toValidationResult(sortIssuesBySeverity(issues))
}
