import type { z } from 'zod'

import type { ParamValues } from '../../model-graph/node-spec'
import { paramsSchemaOf } from '../../param/param-def'
import type { Issue, IssueCode } from '../issue'
import { issueError } from '../issue'
import type { ValidationRule } from '../validation-input'
import { nodeTypeOf } from '../validation-input'

/**
 * パラメータが制約を満たしているかを調べる(指示書 8 章「kernel_size >= 1 など」)。
 *
 * 制約を if 文で書き直さず、カタログの ParamDef から導いた Zod スキーマで検証する。
 * 制約の宣言はカタログ 1 か所だけなので、「フォームでは 1 以上にしているのに
 * 検証では 0 を通す」というずれが起こらない。
 *
 * Zod のエラーを Issue に写すとき、path からパラメータ名を取り出して
 * paramName に入れる。プロパティパネルが該当する入力欄の横に表示できるようにするため。
 */
export const validateParams: ValidationRule = (input) => {
  const issues: Issue[] = []

  for (const node of input.graph.nodes) {
    const def = nodeTypeOf(input.catalog, node)
    if (def === undefined) continue // node/unknown-type として報告済み

    const result = paramsSchemaOf(def.params).safeParse(node.spec.params)
    if (result.success) continue

    for (const zodIssue of result.error.issues) {
      issues.push(toIssue(node.id, def.label, node.spec.params, zodIssue))
    }
  }

  return issues
}

function toIssue(
  nodeId: Issue['nodeId'],
  nodeLabel: string,
  params: ParamValues,
  zodIssue: z.core.$ZodIssue,
): Issue {
  // 定義にないパラメータ。Zod は path を空にし、keys に名前を入れてくる
  if (zodIssue.code === 'unrecognized_keys') {
    const names = zodIssue.keys.join(' / ')
    return issueError('param/unknown', `${nodeLabel} に ${names} というパラメータはありません。`, {
      nodeId,
      paramName: zodIssue.keys[0],
    })
  }

  const paramName = typeof zodIssue.path[0] === 'string' ? zodIssue.path[0] : undefined

  // キーが欠けている(param/missing)か、値が制約を満たさない(param/invalid)かを分ける。
  //
  // Zod 4 はどちらも code を invalid_type で返すことがあり、issue に入力値
  // (zodIssue.input)を載せないため、Zod の情報だけでは区別できない。
  // そこで「そのキーが実際に存在するか」を元の params で直接確かめる。
  // ライブラリの内部表現に依存しない判定なので、版が上がっても壊れにくい。
  const code: IssueCode =
    zodIssue.code === 'invalid_type' && paramName !== undefined && !Object.hasOwn(params, paramName)
      ? 'param/missing'
      : 'param/invalid'

  const label = paramName !== undefined ? `${nodeLabel} の ${paramName}` : nodeLabel
  const message =
    code === 'param/missing'
      ? `${label} が設定されていません。`
      : `${label} の値が不正です: ${zodIssue.message}`

  return issueError(code, message, { nodeId, paramName })
}
