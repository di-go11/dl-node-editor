import createClient from 'openapi-fetch'
import type { Client } from 'openapi-fetch'
import { z } from 'zod'

import type { ApiError, ApiResult } from '../../application/ports/api-result'
import { apiError, apiOk } from '../../application/ports/api-result'
import type { paths } from '../../api/schema'
import type { Issue } from '../../entity/validation/issue'

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

const japaneseErrors = z.locales.ja().localeError

type FetchResult = {
  readonly data?: unknown
  /** エラーの状態コードのときの本文(openapi-fetch が JSON として読む。本文がなければ空) */
  readonly error?: unknown
  readonly response: Response
}

/**
 * エラーの応答の本文を見て、何かに読み替える関数(読み替えられなければ undefined)。
 * 学習設定の誤りの 422 は本文に違反の一覧があるので、状態コードだけでは足りない。
 */
export type ErrorBodyReader<T> = (status: number, body: unknown) => T | undefined

/**
 * 状態コードごとの説明。契約のエラー応答の多くには本文がないので、状態コードから文言を決める
 * (学習設定の誤りの 422 だけは違反の一覧の本文があり、ErrorBodyReader で別に読む)。
 * 409 と 422 は学習開始の意味で書いている(整合性チェックの 409 は callApiByStatus で先に結果にする)。
 * 意味が違う API(学習再開など)は、callApi の messages で上書きする。
 */
const HTTP_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  404: '指定されたジョブが見つかりません。',
  409: 'すでに実行中の学習があります。',
  422: '学習設定またはモデル構造が受け付けられませんでした。',
  502: '学習サーバーに接続できません。',
}

/** 状態コード → 利用者に見せる説明(API ごとに既定の説明を上書きする) */
export type HttpErrorMessages = Readonly<Record<number, string>>

function httpError(response: Response, messages: HttpErrorMessages = {}): ApiError {
  return {
    kind: 'http',
    status: response.status,
    message:
      messages[response.status] ??
      HTTP_ERROR_MESSAGES[response.status] ??
      `サーバーがエラーを返しました(HTTP ${response.status})。`,
  }
}

/**
 * 本文のない応答を返す API(POST /trainings/validate の 204 など)の呼び出しを、ApiResult に包む。
 *
 * 同じ状態コードでも意味が API ごとに違う(validate の 409 は「名前が使用済み」で、
 * 学習開始の 409 は「実行中の学習がある」)。そこで、結果として受け取る状態コードと
 * その値の対応(byStatus)は呼び出し側が渡す。対応にないエラーの状態コードは kind: 'http' にする。
 * messages を渡すと、そのエラーの説明をその API の意味で上書きできる(callApi と同じ)。
 * fromErrorBody を渡すと、エラーの本文から結果を作れる(整合性チェックの 422 の違反の一覧など)。
 * 読み替えられなかったエラーは、これまでどおり状態コードで扱う。
 */
export async function callApiByStatus<T>(
  call: () => Promise<FetchResult>,
  byStatus: Readonly<Record<number, T>>,
  messages?: HttpErrorMessages,
  fromErrorBody?: ErrorBodyReader<T>,
): Promise<ApiResult<T>> {
  let result: FetchResult
  try {
    result = await call()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return apiError({ kind: 'network', message: `サーバーに接続できません: ${detail}` })
  }
  const { response } = result

  if (!response.ok && fromErrorBody !== undefined) {
    const fromBody = fromErrorBody(response.status, result.error)
    if (fromBody !== undefined) return apiOk(fromBody)
  }
  const value = byStatus[response.status]
  if (value !== undefined) return apiOk(value)
  if (!response.ok) return apiError(httpError(response, messages))
  return apiError({
    kind: 'invalid-response',
    message: `サーバーが契約にない状態コードを返しました(HTTP ${response.status})。`,
  })
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
 *
 * messages を渡すと、エラーの状態コードの説明をその API の意味で上書きできる
 * (学習再開の 404 は「モデルが見つからない」で、学習開始の 404 とは違う)。
 *
 * issuesFromErrorBody を渡すと、エラーの本文にある違反の一覧(学習開始の 422 など)を
 * ApiError の issues に入れる。本文がない・形が違うときは issues を付けない。
 */
export async function callApi<Json, T>(
  call: () => Promise<FetchResult>,
  schema: z.ZodType<Json>,
  convert: (json: Json) => T,
  messages?: HttpErrorMessages,
  issuesFromErrorBody?: ErrorBodyReader<readonly Issue[]>,
): Promise<ApiResult<T>> {
  let result: FetchResult
  try {
    result = await call()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return apiError({ kind: 'network', message: `サーバーに接続できません: ${detail}` })
  }

  if (!result.response.ok) {
    const error = httpError(result.response, messages)
    const issues = issuesFromErrorBody?.(result.response.status, result.error)
    return apiError(issues === undefined ? error : { ...error, issues })
  }

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
