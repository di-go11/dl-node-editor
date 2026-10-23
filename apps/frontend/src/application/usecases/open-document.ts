import { fillMissingPositions } from '../../entity/document/auto-layout'
import type { EditorDocument } from '../../entity/document/document'
import type { EditorFileKind } from '../../entity/document/import-config'
import { parseEditorFileText } from '../../entity/document/import-config'
import type { Issue } from '../../entity/validation/issue'
import type { DocumentStorage } from '../ports/document-storage'

/**
 * ユースケース「ファイルを開く」。
 *
 *   1. ファイルを選んでもらい、中身を読む(ポート DocumentStorage)
 *   2. 保存ファイルか C++ の設定ファイルとして検証・変換する(エンティティ層)
 *   3. 座標のないノードに座標を補う(エンティティ層の fillMissingPositions)
 *
 * 結果は 4 通りに分け、画面がそれぞれに合った表示をできるようにする。
 * 不正なファイル(invalid)は「どこがおかしいか」の Issue を持ち、ログに出す(指示書 7.2)。
 *
 * 今の文書を入れ替えるかどうか(保存していない変更の確認)は、ここでは決めない。
 * 確認ダイアログは画面の都合であり、このユースケースを呼ぶ前に presentation 層が行う。
 */

export type OpenDocumentDeps = {
  readonly storage: DocumentStorage
}

export type OpenDocumentResult =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'invalid'; readonly fileName: string; readonly issues: readonly Issue[] }
  | {
      readonly kind: 'opened'
      readonly fileName: string
      readonly source: EditorFileKind
      readonly document: EditorDocument
    }

export async function openDocument(deps: OpenDocumentDeps): Promise<OpenDocumentResult> {
  const opened = await deps.storage.open()
  if (opened.kind !== 'opened') return opened

  const { name, text } = opened.file
  const parsed = parseEditorFileText(text)
  if (!parsed.ok) return { kind: 'invalid', fileName: name, issues: parsed.issues }

  return {
    kind: 'opened',
    fileName: name,
    source: parsed.kind,
    document: fillMissingPositions(parsed.document),
  }
}
