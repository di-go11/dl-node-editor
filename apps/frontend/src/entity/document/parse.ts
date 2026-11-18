import { z } from 'zod'

import { fromProtoJson } from '../model-graph/proto-json/convert'
import { trainingSettingsFromJson } from '../training/proto-json/convert'
import type { Issue } from '../validation/issue'
import { issueError } from '../validation/issue'

import type { EditorDocument, Position } from './document'
import { migrateDocument } from './migrate'
import type { MigrationOptions } from './migrate'
import type { DocumentJson } from './schema'
import { documentJsonSchema } from './schema'

/**
 * 保存ファイルの読み込み:文字列 → EditorDocument。
 *
 *   文字列 ─[JSON.parse]─▶ unknown ─[版の移行]─▶ 最新版の形 ─[Zod]─▶ 検証済みの JSON ─[変換]─▶ EditorDocument
 *
 * ## 外部入力として扱う
 *
 * ファイルは利用者が選ぶもので、中身は何でもありうる(別の JSON、壊れたファイル、
 * 手で書き換えたファイル)。そこで TypeScript の型を信じず、実行時にすべて検証する。
 * 失敗は例外にせず、どこがおかしいかを Issue の配列で返し、ログに出せるようにする。
 *
 * ## 例外ではなく結果の型で返す理由
 *
 * 不正なファイルは「起こりうる普通の出来事」であって、プログラムの誤りではない。
 * 例外にすると、呼び出し側が try を書き忘れたとき画面ごと落ちる。
 * 結果の型(ok で分かれる合併型)なら、失敗の場合を扱わないとコンパイルが通らない。
 */

export type ParseDocumentResult =
  | { readonly ok: true; readonly document: EditorDocument }
  | { readonly ok: false; readonly issues: readonly Issue[] }

/**
 * Zod の既定のメッセージを日本語にする。
 *
 * z.config() で全体の設定を変えず、解析 1 回ぶんだけに渡している。エンティティ層の
 * モジュールが、読み込まれただけでライブラリ全体の設定を書き換えるのは避けたいためである。
 * スキーマに自分で書いたメッセージ(ノード ID の文字種など)は、こちらより優先される。
 */
export const japaneseErrors = z.locales.ja().localeError

/** Zod の path を 'model.model_graph.nodes[2].id' のような読める形にする */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, key) => {
    if (typeof key === 'number') return `${text}[${key}]`
    const name = String(key)
    return text === '' ? name : `${text}.${name}`
  }, '')
}

/**
 * Zod の検証エラーを、場所(field)付きの Issue に直す。
 * 保存ファイルと C++ の設定ファイル(import-config.ts)の両方の読み込みで使う。
 */
export function structureIssuesOf(zodIssues: readonly z.core.$ZodIssue[]): readonly Issue[] {
  return zodIssues.map((zodIssue) => {
    const field = formatIssuePath(zodIssue.path)
    const message = field === '' ? zodIssue.message : `${field}: ${zodIssue.message}`
    return issueError('document/invalid-structure', message, field === '' ? {} : { field })
  })
}

/** 文字列を JSON として読む。読めなければ document/invalid-json の Issue を返す */
export function parseJsonText(
  text: string,
):
  | { readonly ok: true; readonly raw: unknown }
  | { readonly ok: false; readonly issues: readonly Issue[] } {
  try {
    return { ok: true, raw: JSON.parse(text) as unknown }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      issues: [issueError('document/invalid-json', `JSON として読めないファイルです: ${detail}`)],
    }
  }
}

function toDocument(json: DocumentJson): EditorDocument {
  const positions = new Map<string, Position>()
  for (const [id, position] of Object.entries(json.editor?.positions ?? {})) {
    positions.set(id, { x: position.x, y: position.y })
  }

  const viewport = json.editor?.viewport
  return {
    meta: { name: json.meta.name, savedAt: json.meta.saved_at ?? null },
    context: { dataDim: json.context.data_dim, method: json.context.method },
    // nodes の並び順はそのまま保たれる(fromProtoJson が順序を変えないため。指示書 7.3)
    graph: fromProtoJson(json.model.model_graph),
    layout: {
      positions,
      viewport:
        viewport === undefined ? null : { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    },
    training: json.training === undefined ? null : trainingSettingsFromJson(json.training),
  }
}

/** JSON.parse 済みの値から読み込む */
export function parseDocument(raw: unknown, options: MigrationOptions = {}): ParseDocumentResult {
  const migrated = migrateDocument(raw, options)
  if (!migrated.ok) return migrated

  const result = documentJsonSchema.safeParse(migrated.document, { error: japaneseErrors })
  if (!result.success) return { ok: false, issues: structureIssuesOf(result.error.issues) }

  return { ok: true, document: toDocument(result.data) }
}

/** ファイルの中身(文字列)から読み込む */
export function parseDocumentText(
  text: string,
  options: MigrationOptions = {},
): ParseDocumentResult {
  const json = parseJsonText(text)
  if (!json.ok) return json
  return parseDocument(json.raw, options)
}
