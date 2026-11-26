use entities::training::config::TrainingConfig;
use entities::validation::ConfigViolation;

use super::error::ModelGraphValidatorError;
use super::ports::ModelGraphValidator;

// 学習開始前の設定の確認(新規学習と整合性チェックで共通)。
//   1. 値の範囲(entities の TrainingConfig::validate)
//   2. グラフの構造と形(C++ の ValidateModelGraph)
// の違反を 1 つの一覧にまとめる(docs/issues/2026-11-26/学習設定の検証をRustに集める.md の段階 3)。
#[derive(Debug, PartialEq)]
pub(crate) enum ConfigCheckError {
    // 違反があった(値とグラフの両方を含む)
    Invalid(Vec<ConfigViolation>),
    // C++ での確認ができなかった
    GraphCheckFailed(ModelGraphValidatorError),
}

// C++ はグラフを受け取るときに、層のパラメータと data_spec の値も確かめて、不正なら依頼ごと拒否する
// (違反の一覧ではなく INVALID_ARGUMENT になる)。その場合は C++ を呼ばず、値の違反だけを返す。
// 利用者が値を直して送り直すと、次はグラフの違反が返る。
fn blocks_graph_check(violation: &ConfigViolation) -> bool {
    violation.field.starts_with("model_graph.") || violation.field.starts_with("data_spec.")
}

pub(crate) async fn check_training_config<M: ModelGraphValidator>(
    config: &TrainingConfig,
    validator: &M,
) -> Result<(), ConfigCheckError> {
    let mut violations = config.validate().err().unwrap_or_default();

    if !violations.iter().any(blocks_graph_check) {
        let graph_violations = validator
            .validate_model_graph(&config.model_graph, &config.data_spec, &config.dataset_path)
            .await
            .map_err(ConfigCheckError::GraphCheckFailed)?;
        violations.extend(graph_violations);
    }

    if violations.is_empty() {
        Ok(())
    } else {
        Err(ConfigCheckError::Invalid(violations))
    }
}
