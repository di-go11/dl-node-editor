import { z } from 'zod'

import type { ErrorBodyReader, ErrorDetails } from './api-client'
import type { SentRequest } from './config-violations'
import { configViolationIssues } from './config-violations'

/**
 * 違反の一覧のない 422 の本文(契約の ErrorCode)。同じ 422 でも原因が違うものを、文言で区別する。
 *
 * これがないと「データセットがない」「色表が読めない」「リクエストの中身が受け付けられない」が
 * 同じ説明になり、利用者にも開発者にも原因が分からない。
 */

export const errorCodeSchema = z.object({
  error: z.enum(['dataset_not_found', 'dataset_unreadable', 'invalid_request']),
})

export type ServerErrorCode = z.infer<typeof errorCodeSchema>['error']

export function serverErrorCode(body: unknown): ServerErrorCode | undefined {
  const parsed = errorCodeSchema.safeParse(body)
  return parsed.success ? parsed.data.error : undefined
}

export const ERROR_CODE_MESSAGES: Readonly<Record<ServerErrorCode, string>> = {
  dataset_not_found:
    '選んだデータセットが見つかりません(削除された可能性があります)。データセットを選び直してください。',
  dataset_unreadable:
    'データセットの色表(labelmap.txt)を読めないため、クラス数が分かりません。データセットの中身を確認してください。',
  invalid_request:
    'リクエストの中身が受け付けられませんでした。未選択の項目(データセットなど)がないか確認してください。',
}

/**
 * 本文が JSON ではない 422(サーバーのフレームワークが、JSON として読めない・フィールドが足りないときに返す説明)。
 * 画面が作るリクエストの形がサーバーと合っていない(版の食い違いなど)ことを示す。
 */
export const REQUEST_SHAPE_MESSAGE =
  'サーバーがリクエストの形を読めませんでした。画面とサーバーの版が合っていない可能性があります。'

function isPlainTextBody(body: unknown): boolean {
  return typeof body === 'string' && body.trim() !== ''
}

/**
 * 学習開始・学習再開の 422 の本文から、エラーの説明と違反の一覧を作る(callApi に渡す)。
 *   違反の一覧(InvalidConfig)       → issues(位置付き。説明は状態コードのまま)
 *   原因のコード(ErrorCode)         → その原因の説明
 *   JSON でない本文                  → リクエストの形が合わないという説明
 *   本文なし                         → 状態コードの説明のまま(optimizer の種類を変えた再開など)
 */
export function trainingRejectionDetails(request: SentRequest): ErrorBodyReader<ErrorDetails> {
  return (status, body) => {
    if (status !== 422) return undefined
    const issues = configViolationIssues(body, request)
    if (issues !== undefined) return { issues }
    const code = serverErrorCode(body)
    if (code !== undefined) return { message: ERROR_CODE_MESSAGES[code] }
    if (isPlainTextBody(body)) return { message: REQUEST_SHAPE_MESSAGE }
    return undefined
  }
}
