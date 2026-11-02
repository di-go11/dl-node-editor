import type { Issue } from '../validation/issue'
import { issueError } from '../validation/issue'

import { DOCUMENT_FORMAT } from './document'

/**
 * 保存ファイルの版の移行。
 *
 * ## なぜ版を持つのか
 *
 * 保存ファイルの形は、機能を足すうちに必ず変わる。そのとき古いファイルが開けなくなると、
 * 研究の途中のモデルを失うことになる。そこでファイルに version を書いておき、
 * 読み込むときに「古い版 → 新しい版」の変換を順にかけてから、最新版のスキーマで検証する。
 *
 *   v1 のファイル ─[1→2]─▶ v2 の形 ─[2→3]─▶ v3 の形 ─▶ 最新版のスキーマで検証
 *
 * 変換は「1 つ前の版から 1 つ次の版へ」だけを書く。v1→v3 のような飛び越しを書かないので、
 * 版が増えても書く変換は 1 つずつで済み、各変換は単体でテストできる。
 *
 * ## 今の状態
 *
 * まだ版 1 しかないので、変換は 1 つもない。版 2 を作るときは、
 * CURRENT_DOCUMENT_VERSION を 2 にし、DOCUMENT_MIGRATIONS に 1 → 2 の変換を足し、
 * schema.ts に版 2 のスキーマを作る。
 *
 * 変換は検証前の生の JSON に対して行うので、型は Record<string, unknown> にしている。
 * 古い版のスキーマを全部残しておくより、変換の中で必要な項目だけを扱うほうが軽い。
 */

export const CURRENT_DOCUMENT_VERSION = 1

export type RawDocument = Readonly<Record<string, unknown>>

/** ある版の文書を、1 つ次の版に変換する */
export type DocumentMigration = (document: RawDocument) => RawDocument

/** キーは変換元の版。DOCUMENT_MIGRATIONS[n] は版 n を版 n + 1 にする */
export type DocumentMigrations = Readonly<Record<number, DocumentMigration>>

export const DOCUMENT_MIGRATIONS: DocumentMigrations = {}

export type MigrationResult =
  | { readonly ok: true; readonly document: RawDocument }
  | { readonly ok: false; readonly issues: readonly Issue[] }

export type MigrationOptions = {
  readonly migrations?: DocumentMigrations
  readonly currentVersion?: number
}

function isRecord(value: unknown): value is RawDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const fail = (issue: Issue): MigrationResult => ({ ok: false, issues: [issue] })

/**
 * 生の JSON を最新版の形にする。
 *
 * options はテスト用である。本物の変換がまだないので、テストでは架空の
 * 版 0 → 1 の変換を渡して、連鎖の仕組みそのものを確かめる。
 */
export function migrateDocument(raw: unknown, options: MigrationOptions = {}): MigrationResult {
  const migrations = options.migrations ?? DOCUMENT_MIGRATIONS
  const currentVersion = options.currentVersion ?? CURRENT_DOCUMENT_VERSION

  if (!isRecord(raw) || raw.format !== DOCUMENT_FORMAT) {
    return fail(
      issueError(
        'document/not-a-document',
        `モデルエディタの保存ファイルではありません(format が "${DOCUMENT_FORMAT}" ではありません)。`,
        { field: 'format' },
      ),
    )
  }

  const version = raw.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return fail(
      issueError('document/unsupported-version', 'version が正しくありません。', {
        field: 'version',
      }),
    )
  }

  if (version > currentVersion) {
    // 新しい版のエディタで保存したファイルを、古い版で開いた場合。
    // 知らない項目を黙って捨てて読むと、保存し直したときに情報が消えるので、読まない。
    return fail(
      issueError(
        'document/unsupported-version',
        `このファイルは新しい版(version ${version})のエディタで保存されています。` +
          `このエディタが読めるのは version ${currentVersion} までです。`,
        { field: 'version' },
      ),
    )
  }

  let document: RawDocument = raw
  for (let from = version; from < currentVersion; from++) {
    const migration = migrations[from]
    if (migration === undefined) {
      return fail(
        issueError(
          'document/unsupported-version',
          `version ${from} のファイルを読む方法がありません。`,
          { field: 'version' },
        ),
      )
    }
    // 変換が version を書き換え忘れても連鎖が崩れないよう、ここで版を進める
    document = { ...migration(document), version: from + 1 }
  }

  return { ok: true, document }
}
