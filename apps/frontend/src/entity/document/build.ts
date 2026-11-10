import { toProtoJson } from '../model-graph/proto-json/convert'
import { trainingSettingsToJson } from '../training/proto-json/convert'

import type { EditorDocument } from './document'
import { DOCUMENT_FORMAT } from './document'
import { CURRENT_DOCUMENT_VERSION } from './migrate'
import type { DocumentV1Json, PositionJson } from './schema'

/**
 * 保存ファイルの書き出し:EditorDocument → JSON 表記(版 1)。
 *
 * 保存日時は引数で受け取る。関数の中で new Date() を呼ぶと、同じ入力でも
 * 呼ぶたびに結果が変わり(純粋関数でなくなり)、テストで結果を比べられなくなるためである。
 * 「今の時刻」を知るのは外側の層(ユースケース)の役目にする。
 */
export function buildDocumentJson(document: EditorDocument, savedAt: Date): DocumentV1Json {
  // Map → 普通のオブジェクト。Object.fromEntries は Map の挿入順を保つ
  const positions: Record<string, PositionJson> = Object.fromEntries(
    [...document.layout.positions].map(([id, { x, y }]) => [id, { x, y }]),
  )

  const viewport = document.layout.viewport
  const json: DocumentV1Json = {
    format: DOCUMENT_FORMAT,
    version: CURRENT_DOCUMENT_VERSION,
    meta: { name: document.meta.name, saved_at: savedAt.toISOString() },
    context: { data_dim: document.context.dataDim, method: document.context.method },
    model: { model_graph: toProtoJson(document.graph) },
    editor: viewport === null ? { positions } : { positions, viewport: { ...viewport } },
  }

  // 学習設定が未設定なら、キーごと省く(指示書 7.2)
  return document.training === null
    ? json
    : { ...json, training: trainingSettingsToJson(document.training) }
}

/**
 * ファイルに書く文字列にする。
 *
 * 2 文字の字下げを付けるのは、git で差分を見たり、手で読んだりできるようにするためである。
 * 研究ではモデルの版を git で管理することが多く、1 行に詰めると差分が読めない。
 */
export function serializeDocument(document: EditorDocument, savedAt: Date): string {
  return `${JSON.stringify(buildDocumentJson(document, savedAt), null, 2)}\n`
}
