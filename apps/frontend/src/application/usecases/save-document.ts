import { serializeDocument } from '../../entity/document/build'
import type { EditorDocument } from '../../entity/document/document'
import type { DocumentStorage } from '../ports/document-storage'

/**
 * ユースケース「文書を保存する」。
 *
 * ## ユースケースとは
 *
 * クリーンアーキテクチャのユースケース(application 層)は、「アプリが利用者に提供する
 * 1 つの操作」の手順を書く場所である。ここでは
 *
 *   1. 今の時刻を決める
 *   2. 文書を保存ファイルの文字列にする(エンティティ層の serializeDocument)
 *   3. 保存先に渡す(ポート DocumentStorage)
 *
 * という流れだけを書き、文字列の形式もファイルの扱いも知らない。
 * 時刻(now)と保存先(storage)を引数で受け取るので、テストでは決まった時刻と
 * 偽物の保存先を渡して、Node 上で手順を確かめられる。
 */

export type SaveDocumentDeps = {
  readonly storage: DocumentStorage
  readonly now: () => Date
}

export type SaveDocumentResult =
  | { readonly ok: true; readonly fileName: string; readonly savedAt: string }
  | { readonly ok: false; readonly message: string }

/**
 * 文書の名前から、ファイル名を作る。
 *
 * OS がファイル名に使えない文字(/ \ : * ? " < > | と制御文字)を _ に置き換える。
 * 日本語は残す(研究室内でのファイル名として自然なため)。空なら untitled にする。
 */
export function documentFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- 制御文字を取り除くのが目的
  const safe = name.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')
  return `${safe === '' ? 'untitled' : safe}.json`
}

export async function saveDocument(
  deps: SaveDocumentDeps,
  document: EditorDocument,
): Promise<SaveDocumentResult> {
  const savedAt = deps.now()
  const fileName = documentFileName(document.meta.name)
  const result = await deps.storage.save(fileName, serializeDocument(document, savedAt))
  if (!result.ok) return result
  return { ok: true, fileName, savedAt: savedAt.toISOString() }
}
