use entities::training::config::TrainingConfig;
use entities::{model::ModelId, training::{JobId, TrainingJobStatus}};

use super::error::{StartTrainingError, StopTrainingError};

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
