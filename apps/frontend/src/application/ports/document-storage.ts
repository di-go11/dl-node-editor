/**
 * 文書(保存ファイル)の保存先。
 *
 * MVP の実装は、ブラウザのダウンロードとアップロード(指示書 7.1。infrastructure/file)。
 * ファイルの中身(文字列)を作るのはエンティティ層、どこに置くかはこのポートの実装、と
 * 責務を分けている。将来サーバーに保存するようになっても、実装を差し替えるだけで済む。
 *
 * ファイル選択は、利用者がダイアログを閉じる(キャンセルする)ことがある。
 * キャンセルは失敗ではないので、結果の型で区別する。
 */

export type SaveFileResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string }

export type OpenedFile = {
  readonly name: string
  readonly text: string
}

export type OpenFileResult =
  | { readonly kind: 'opened'; readonly file: OpenedFile }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

export type DocumentStorage = {
  save(fileName: string, text: string): Promise<SaveFileResult>
  /**
   * ファイルを選んでもらい、中身を読む。
   *
   * ブラウザはファイル選択のダイアログを「利用者の操作(クリックやキー入力)の直後」にしか
   * 開かせない。そのため、ボタンのイベントの中から await を挟まずに呼ぶこと。
   */
  open(): Promise<OpenFileResult>
}
