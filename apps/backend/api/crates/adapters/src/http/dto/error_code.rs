use serde::Serialize;

// 違反の一覧のない 4xx の本文。同じ状態コードでも原因が違うものを、フロントが文言で区別できるようにする
// (違反の一覧がある 422 は InvalidConfigDto。作業 9 のエラーコードと同じ書き方)。
#[derive(Debug, Serialize)]
pub struct ErrorCodeDto {
    pub error: ErrorCode,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    // 本体で指定された dataset_id のデータセットが登録されていない
    DatasetNotFound,
    // データセットの色表(labelmap.txt)が読めず、クラス数が分からない
    DatasetUnreadable,
    // リクエストの中身が受け付けられない(空の dataset_id など)。JSON として読めないときは axum が本文を返す
    InvalidRequest,
}
