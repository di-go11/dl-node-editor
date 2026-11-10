import { DEFAULT_EDITOR_CONTEXT } from '../editor-context/editor-context'
import { fromStartTrainingRequestJson } from '../training/proto-json/convert'
import { startTrainingRequestJsonSchema } from '../training/proto-json/schema'
import { issueError } from '../validation/issue'

import type { EditorDocument } from './document'
import { DOCUMENT_FORMAT } from './document'
import type { ParseDocumentResult } from './parse'
import { japaneseErrors, parseDocument, parseJsonText, structureIssuesOf } from './parse'

/**
 * エディタで開けるファイルの読み込み。2 つの形式を受け付ける。
 *
 *   1. 保存ファイル(指示書 7 章)          … "format": "model-editor-document" を持つ
 *   2. C++ の設定ファイル(学習開始の JSON)… test_segnet_dag.json の形。model_graph を持つ
 *
 * 2 は、手元にある既存の設定をエディタで開くためのもの(ユーザーと合意済み)。
 * モデル構造と学習設定を取り込み、エディタの見た目の情報(座標)はないので空にする。
 * 座標は読み込んだあとに auto-layout.ts が補う。
 *
 * どちらの形式かは、format の有無で決める。format があるのに壊れているファイルを
 * 設定ファイルとして読み直すと、本当の原因(保存ファイルの誤り)と違うエラーが出てしまうので、
 * format があれば必ず保存ファイルとして扱う。
 */

export type EditorFileKind = 'document' | 'training-config'

export type ParseEditorFileResult =
  | { readonly ok: true; readonly kind: EditorFileKind; readonly document: EditorDocument }
  | Extract<ParseDocumentResult, { readonly ok: false }>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** C++ の設定ファイル(StartTrainingRequest の JSON)を、エディタの文書にする */
export function documentFromTrainingConfig(raw: unknown): ParseDocumentResult {
  const result = startTrainingRequestJsonSchema.safeParse(raw, { error: japaneseErrors })
  if (!result.success) return { ok: false, issues: structureIssuesOf(result.error.issues) }

  const { graph, settings } = fromStartTrainingRequestJson(result.data)
  return {
    ok: true,
    document: {
      // 文書の名前は model_name から取る(どちらも「このモデルの名前」なので)
      meta: { name: settings.modelName, savedAt: null },
      // 設定ファイルは条件を持たない。今あるノードはすべて 2D / CNN 用なので既定値にする
      context: DEFAULT_EDITOR_CONTEXT,
      graph,
      layout: { positions: new Map(), viewport: null },
      training: settings,
    },
  }
}

export function parseEditorFileText(text: string): ParseEditorFileResult {
  const json = parseJsonText(text)
  if (!json.ok) return json
  const raw = json.raw

  if (isRecord(raw) && 'format' in raw) {
    const result = parseDocument(raw)
    return result.ok ? { ok: true, kind: 'document', document: result.document } : result
  }

  if (isRecord(raw) && 'model_graph' in raw) {
    const result = documentFromTrainingConfig(raw)
    return result.ok ? { ok: true, kind: 'training-config', document: result.document } : result
  }

  return {
    ok: false,
    issues: [
      issueError(
        'document/not-a-document',
        `開けるのは、モデルエディタの保存ファイル("format": "${DOCUMENT_FORMAT}" を持つ JSON)か、` +
          '学習の設定ファイル(model_graph を持つ JSON)だけです。',
      ),
    ],
  }
}
