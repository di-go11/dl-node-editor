import createClient from 'openapi-fetch'
import type { Client } from 'openapi-fetch'
import { z } from 'zod'

import type { ApiError, ApiResult } from '../../application/ports/api-result'
import { apiError, apiOk } from '../../application/ports/api-result'
import type { paths } from '../../api/schema'

/**
 * HTTP クライアント(契約 openapi.yaml に従う)。
 *
 * openapi-fetch は、openapi.yaml から生成した型(paths)を使って、パス・クエリ・
 * リクエストとレスポンスの型をコンパイル時に検査する fetch の薄いラッパーである。
 * 契約にないパスを呼んだり、フィールド名を間違えたりすると、tsc が教えてくれる。
 *
 * ただし型は「サーバーが契約を守っている」という前提にすぎない。実行時には
 * 何が返ってくるか分からないので、受け取った値は callApi で Zod により検証してから
 * エンティティの型に変換する(指示書 3 章「API レスポンスは外部入力」)。
 */

export type ApiClient = Client<paths>

/** 契約のベースパス(指示書 6.1) */
export const API_BASE_PATH = '/api/v1'

/**
 * baseUrl はテストのためだけに変えられる。ブラウザでは相対パス(同一オリジン)で呼び、
 * Vite の proxy が Rust の API に転送する。Node(テスト)には「今のページ」が
 * ないので、絶対 URL を渡す。
 */
export function createApiClient(baseUrl: string = API_BASE_PATH): ApiClient {
  return createClient<paths>({ baseUrl })
}

/** 契約の ErrorResponse。エラーの本文がこの形なら、メッセージとコードを取り出す */
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
})

const japaneseErrors = z.locales.ja().localeError

type FetchResult = {
  readonly data?: unknown
  readonly error?: unknown
  readonly response: Response
}

function httpError(response: Response, body: unknown): ApiError {
  const parsed = errorResponseSchema.safeParse(body)
  if (parsed.success) {
    return {
      kind: 'http',
      status: response.status,
      code: parsed.data.error.code,
      message: parsed.data.error.message,
    }
  }
  return {
    kind: 'http',
    status: response.status,
    message: `サーバーがエラーを返しました(HTTP ${response.status})。`,
  }
}

/**
 * openapi-fetch の呼び出しを、ApiResult に包む。
 *
 *   1. 通信そのものの失敗(fetch の例外)     → kind: 'network'
 *   2. エラーの状態コード(4xx / 5xx)         → kind: 'http'
 *   3. 成功だが、本文が契約の形をしていない     → kind: 'invalid-response'
 *   4. 成功し、形も正しい                     → convert でエンティティの型に変換して返す
 *
 * 4 つの場合の扱いを 1 か所にまとめ、各 API の実装は「どの schema で検証し、
 * どう変換するか」だけを書けばよいようにしている。
 */
export async function callApi<Json, T>(
  call: () => Promise<FetchResult>,
  schema: z.ZodType<Json>,
  convert: (json: Json) => T,
): Promise<ApiResult<T>> {
  let result: FetchResult
  try {
    result = await call()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return apiError({ kind: 'network', message: `サーバーに接続できません: ${detail}` })
  }

  if (!result.response.ok) return apiError(httpError(result.response, result.error))

  const parsed = schema.safeParse(result.data, { error: japaneseErrors })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first === undefined ? '' : `${first.path.join('.')}: `
    return apiError({
      kind: 'invalid-response',
      message: `サーバーの応答が契約の形をしていません(${where}${first?.message ?? ''})。`,
    })
  }

  return apiOk(convert(parsed.data))
}
