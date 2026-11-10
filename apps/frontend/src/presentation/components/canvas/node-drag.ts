/**
 * サイドバー → キャンバスへのドラッグ&ドロップで受け渡すデータの形式。
 *
 * HTML5 のドラッグ&ドロップは、DataTransfer に「種類(MIME タイプ)→ 文字列」を
 * 入れて受け渡す。独自の種類名にしておくと、ほかの場所(ファイルや別のタブ)から
 * ドロップされたものを、ノードと取り違えずに無視できる。
 */
export const NODE_DRAG_MIME = 'application/x-model-editor-node-type'

export function setDraggedNodeType(dataTransfer: DataTransfer, typeId: string): void {
  dataTransfer.setData(NODE_DRAG_MIME, typeId)
  dataTransfer.effectAllowed = 'copy'
}

/** ドロップされたのがノードでなければ null */
export function getDraggedNodeType(dataTransfer: DataTransfer): string | null {
  const typeId = dataTransfer.getData(NODE_DRAG_MIME)
  return typeId === '' ? null : typeId
}

export function isNodeDrag(dataTransfer: DataTransfer): boolean {
  // dragover の間は、セキュリティのため getData で中身を読めない(種類の一覧だけ見える)
  return dataTransfer.types.includes(NODE_DRAG_MIME)
}
