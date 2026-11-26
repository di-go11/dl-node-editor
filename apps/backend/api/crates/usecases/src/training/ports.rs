use entities::model::ModelGraph;
use entities::training::config::{DataSpec, TrainingConfig};
use entities::validation::ConfigViolation;
use entities::{
    model::ModelId,
    training::{JobId, TrainingJobStatus},
};

use super::error::{ModelGraphValidatorError, StartTrainingError, StopTrainingError};

// 学習を始めずに、モデルのグラフの構造と形を学習エンジン(C++)で確かめるポート。
// グラフの規則は C++ にだけ持つ(docs/issues/学習設定の検証をRustに集める.md の方針)。
// 問題があれば違反の一覧を Ok で返す(field は "model_graph.nodes[3].inputs[0]" などリクエストの JSON の位置)。
// 問題がなければ空の Vec。検証そのものができなかったときだけ Err。
pub trait ModelGraphValidator {
    fn validate_model_graph(
        &self,
        model_graph: &ModelGraph,
        data_spec: &DataSpec,
        // クラス数を求めるため(Original 形式なら labelmap.txt を読む)
        dataset_path: &str,
    ) -> impl Future<Output = Result<Vec<ConfigViolation>, ModelGraphValidatorError>> + Send;
}

pub trait TrainingStarter {
    // model_graph は TrainingConfig のフィールドとして渡す
    fn start_training(
        &self,
        training_config: &TrainingConfig,
        model_id: &ModelId,
    ) -> impl Future<Output = Result<JobId, StartTrainingError>> + Send; // C++サーバーに対して学習プロセスを開始するための命令を送る関数
}

pub trait TrainingStopper {
    fn stop_training(
        &self,
        job_id: &JobId,
    ) -> impl Future<Output = Result<TrainingJobStatus, StopTrainingError>> + Send; // C++サーバーに対して学習プロセスを停止するための命令を送る関数戻り値として、学習ステータスを返す。
}

//モデルから学習再開用のユースケース
pub trait TrainingResumer {
    // model_graph は TrainingConfig のフィールドとして渡す
    fn resume_training(
        &self,
        training_config: &TrainingConfig,
        model_id: &ModelId,
    ) -> impl Future<Output = Result<JobId, StartTrainingError>> + Send; // C++サーバーに対して学習プロセスを開始するための命令を送る関数
}

// job_idを元に進捗記録を始める依頼をインフラにだすためのユースケース
pub trait ProgressRecordingScheduler {
    // asyncにしない、resultを返さない。Recordスケジューラでエラーをだすと学習中にエラー500が変えることになる。
    fn schedule(&self, job_id: JobId);
}
