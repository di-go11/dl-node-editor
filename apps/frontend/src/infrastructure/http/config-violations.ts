import { z } from 'zod'

import { parseNodeId } from '../../entity/model-graph/node-id'
import type { Issue, IssueLocation } from '../../entity/validation/issue'
import { issueError } from '../../entity/validation/issue'

import type { RustResumeTrainingRequest, RustStartTrainingRequest } from './rust-training-request'

/**
 * 違反の位置を直すのに使う、送ったリクエスト。学習開始と学習再開の両方の 422 で使う。
 * 再開のリクエストにはモデルのグラフとデータの仕様がない(サーバーが前回の値を使う)ので、
 * そこを指す違反は、ノードや種類を特定せずに返す。
 */
export type SentRequest = RustStartTrainingRequest | RustResumeTrainingRequest

function sentGraph(request: SentRequest): RustStartTrainingRequest['model_graph'] | undefined {
  return 'model_graph' in request ? request.model_graph : undefined
}

function sentDataSpec(request: SentRequest): RustStartTrainingRequest['data_spec'] | undefined {
  return 'data_spec' in request ? request.data_spec : undefined
}

/**
 * 学習設定の誤りの 422 の本文(契約の InvalidConfig)を、画面の Issue にする。
 *
 * サーバーは値の範囲(Rust)とモデルのグラフの構造・形(学習エンジン)を確かめ、違反をすべて返す
 * (docs/issues/学習設定の検証をRustに集める.md)。違反の位置(field)は Rust の HTTP の JSON の書き方
 * なので、送ったリクエストを使って、画面が使う位置(ノード ID・ポート・パラメータ名、proto-json の項目名)に直す。
 *
 * 位置を直すのは infrastructure の仕事である。Rust の JSON の形を知っているのはこの層だけで
 * (rust-training-request.ts と同じ理由)、ノードの添字からノード ID を引くには送ったリクエストが要る。
 */

export const invalidConfigSchema = z.object({
  error: z.literal('invalid_config'),
  violations: z
    .array(
      z.object({
        field: z.string(),
        message: z.string(),
      }),
    )
    .min(1),
})

const NODE_FIELD = /^model_graph\.nodes\[(\d+)\](?:\.(.+))?$/
const INPUT_FIELD = /^inputs\[(\d+)\]$/
const SPEC_FIELD = /^spec\.(.+)$/
/** ポート単位の問題は、サーバーがメッセージの先頭に「ポート 'x': 」を付けて返す */
const PORT_PREFIX = /^ポート '([^']+)': /

/** model_graph.nodes[i] 以下の位置 → ノード ID・ポート・パラメータ名 */
function nodeLocation(
  index: number,
  rest: string | undefined,
  message: string,
  request: SentRequest,
): IssueLocation {
  const node = sentGraph(request)?.nodes[index]
  const id = node === undefined ? null : parseNodeId(node.id)
  if (node === undefined || id === null) return { field: 'model_graph' }

  if (rest === undefined) {
    const port = PORT_PREFIX.exec(message)?.[1]
    return port === undefined ? { nodeId: id } : { nodeId: id, port }
  }
  const input = INPUT_FIELD.exec(rest)
  if (input !== null) {
    const port = node.inputs[Number(input[1])]?.port
    return port === undefined ? { nodeId: id } : { nodeId: id, port }
  }
  const spec = SPEC_FIELD.exec(rest)
  if (spec?.[1] !== undefined) return { nodeId: id, paramName: spec[1] }
  return { nodeId: id }
}

/**
 * Rust の JSON の位置 → 画面の学習設定の位置(proto-json の項目名。validate-training.ts と同じ書き方)。
 * 種類を選ぶ項目(optimizer など)は、Rust では種類が "type" に入って中身が直下に並ぶが、
 * proto-json では種類の名前の下に並ぶ。
 */
function settingsField(field: string, request: SentRequest): string {
  const [head, ...rest] = field.split('.')
  const tail = rest.join('.')
  if (rest.length === 0) return field
  switch (head) {
    case 'optimizer':
      return `optimizer.${request.optimizer.type}.${tail}`
    case 'loss':
      return `loss.${request.loss.type}.${tail}`
    case 'data_spec': {
      const taskPrefix = 'image_task_spec.'
      if (tail.startsWith(taskPrefix)) {
        // 再開ではデータの仕様を送らないので、タスクの種類が分からない。位置はそのまま返す
        const type = sentDataSpec(request)?.image_task_spec.type
        if (type === undefined) return field
        return `data_spec.image.task_specs.${type}.${tail.slice(taskPrefix.length)}`
      }
      return `data_spec.image.${tail}`
    }
    case 'lr_scheduler': {
      // update_interval / warmup_epochs は種類によらない項目。パラメータ(power など)は種類の名前の下に並ぶ
      if (tail === 'update_interval' || tail === 'warmup_epochs') return field
      // 再開ではスケジューラを送らない(保存した設定で再開する)ので、種類が分からない。位置はそのまま返す
      const type = 'lr_scheduler' in request ? request.lr_scheduler?.type : undefined
      return type === undefined ? field : `lr_scheduler.${type}.${tail}`
    }
    default:
      return field
  }
}

function locationOf(field: string, message: string, request: SentRequest): IssueLocation {
  const node = NODE_FIELD.exec(field)
  if (node !== null) return nodeLocation(Number(node[1]), node[2], message, request)
  // outputs[k] と、グラフ全体の問題(閉路など)。特定のノードではない
  if (field === 'model_graph' || field.startsWith('model_graph.')) return { field: 'model_graph' }
  return { field: settingsField(field, request) }
}

/**
 * 422 の本文が InvalidConfig なら、違反を Issue にして返す。
 * 本文がない・形が違う(データセットがない場合など)なら undefined。
 */
export function configViolationIssues(
  body: unknown,
  request: SentRequest,
): readonly Issue[] | undefined {
  const parsed = invalidConfigSchema.safeParse(body)
  if (!parsed.success) return undefined
  return parsed.data.violations.map(({ field, message }) =>
    issueError('training/server-rejected', message, locationOf(field, message, request)),
  )
}
