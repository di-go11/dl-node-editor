/**
 * 外部(API・ファイル)とのやり取りの結果。
 *
 * ## 例外ではなく値で失敗を返す理由
 *
 * 通信の失敗(サーバーが落ちている、GPU ノードに届かない)は、プログラムの誤りではなく
 * 普通に起こる出来事である。Promise を reject させると、呼び出し側が catch を
 * 書き忘れたときに「未処理の Promise の拒否」になり、画面に何も出ないまま止まる。
 * 結果の型(ok で分かれる合併型)にすれば、失敗の場合を扱わないとコンパイルが通らない。
 * 保存ファイルの読み込み(entity/document/parse.ts)と同じ考え方である。
 */

export type ApiErrorKind =
  /** 送る内容を契約の形にできなかった(サーバーには送っていない) */
  | 'invalid-request'
  /** サーバーに届かなかった(ネットワークの断絶、CORS など) */
  | 'network'
  /** サーバーがエラーの状態コードを返した(4xx / 5xx) */
  | 'http'
  /** 返ってきた内容が契約の形をしていない */
  | 'invalid-response'

export type ApiError = {
  readonly kind: ApiErrorKind
  /** 利用者に見せる説明 */
  readonly message: string
  /** HTTP の状態コード(kind が 'http' のとき) */
  readonly status?: number
}

export type ApiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError }

export function apiOk<T>(value: T): ApiResult<T> {
  return { ok: true, value }
}

export function apiError<T = never>(error: ApiError): ApiResult<T> {
  return { ok: false, error }
}
