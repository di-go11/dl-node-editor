import type {
  DocumentStorage,
  OpenFileResult,
  SaveFileResult,
} from '../../application/ports/document-storage'

/**
 * DocumentStorage のブラウザ実装 - ダウンロードとアップロード(指示書 7.1)。
 *
 * ## 保存(ダウンロード)
 *
 * ブラウザのページは、利用者のディスクに直接書き込めない(安全のため)。そこで
 *   1. 文字列から Blob(メモリ上のファイル)を作る
 *   2. URL.createObjectURL で、その Blob を指す一時的な URL を作る
 *   3. download 属性を付けた <a> をプログラムからクリックする
 * という手順で、ブラウザの「ダウンロード」として保存してもらう。
 * 一時的な URL はメモリを握り続けるので、ダウンロードが始まったら解放する。
 *
 * ## 読込(アップロード)
 *
 * <input type="file"> をプログラムから開き、選ばれたファイルを File.text() で読む。
 * ダイアログを閉じた(キャンセルした)ことは、新しめのブラウザでは cancel イベントで分かる。
 */

export type BrowserDocumentStorageOptions = {
  /** これより大きいファイルは読まない(誤って巨大なファイルを選び、画面が固まるのを防ぐ) */
  readonly maxBytes?: number
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024

/** 一時的な URL を解放するまでの待ち時間。すぐ解放すると、一部のブラウザでダウンロードが始まらない */
const REVOKE_DELAY_MS = 1000

export function createBrowserDocumentStorage(
  options: BrowserDocumentStorageOptions = {},
): DocumentStorage {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const save = (fileName: string, text: string): Promise<SaveFileResult> => {
    try {
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.style.display = 'none'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
      return Promise.resolve({ ok: true })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return Promise.resolve({ ok: false, message: `保存できませんでした: ${detail}` })
    }
  }

  const open = (): Promise<OpenFileResult> =>
    new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'

      input.addEventListener('cancel', () => resolve({ kind: 'cancelled' }), { once: true })
      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0]
          if (file === undefined) {
            resolve({ kind: 'cancelled' })
            return
          }
          if (file.size > maxBytes) {
            const megabytes = (maxBytes / 1024 / 1024).toFixed(0)
            resolve({
              kind: 'failed',
              message: `${file.name} は大きすぎます(${megabytes} MB まで)。`,
            })
            return
          }
          file.text().then(
            (text) => resolve({ kind: 'opened', file: { name: file.name, text } }),
            (error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error)
              resolve({ kind: 'failed', message: `${file.name} を読めませんでした: ${detail}` })
            },
          )
        },
        { once: true },
      )

      // ブラウザは、利用者の操作の直後でないとファイル選択のダイアログを開かない。
      // ボタンのクリックから同期的にここまで来ていれば開ける(DocumentStorage の説明を参照)
      input.click()
    })

  return { save, open }
}
