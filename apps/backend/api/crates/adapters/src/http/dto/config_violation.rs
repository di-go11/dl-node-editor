use entities::validation::ConfigViolation;
use serde::Serialize;

// 学習設定に誤りがあったときの 422 の本文。違反はすべて入れる
// (docs/issues/学習設定の検証をRustに集める.md の「応答の形」)。
#[derive(Debug, Serialize)]
pub struct InvalidConfigDto {
    // エラーの種類。409 などのエラーコード(backend-db-remaining.md 作業 9)と同じ書き方にする
    pub error: &'static str,
    pub violations: Vec<ConfigViolationDto>,
}

#[derive(Debug, Serialize)]
pub struct ConfigViolationDto {
    // 違反のある項目の位置。リクエストの JSON と同じ項目名(例: "optimizer.learning_rate")
    pub field: String,
    pub message: String,
}

impl From<Vec<ConfigViolation>> for InvalidConfigDto {
    fn from(violations: Vec<ConfigViolation>) -> Self {
        Self {
            error: "invalid_config",
            violations: violations
                .into_iter()
                .map(|v| ConfigViolationDto {
                    field: v.field,
                    message: v.message,
                })
                .collect(),
        }
    }
}
