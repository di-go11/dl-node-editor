use super::ModelId;
use crate::training::{JobId, Metrics, TrainingJobStatus};

/// モデルの学習の記録(全 run の、エポックごとの結果)。
/// モデル一覧から開く「学習の記録」の画面で、loss・学習率のグラフとメトリクスの表に使う。
#[derive(Debug, Clone, PartialEq)]
pub struct ModelHistory {
    pub model_id: ModelId,
    pub model_name: String,
    /// 学習を始めた順(新規学習 1 件と、再開ごとに 1 件)
    pub runs: Vec<RunRecord>,
    /// run の順、run の中はエポックの順。
    /// エポック番号は再開をまたいで続く。checkpoint を間引いて保存していると(save_last_every > 1)、
    /// 再開した run が前の run と同じエポック番号を持つことがある。どちらも返す(後の run が新しい値)
    pub epochs: Vec<EpochRecord>,
}

/// 1 回の学習(新規学習または再開)
#[derive(Debug, Clone, PartialEq)]
pub struct RunRecord {
    pub job_id: JobId,
    pub status: TrainingJobStatus,
    pub started_at: String,
    /// 終了を記録できていなければ None(学習中、または記録前に Rust が止まった)
    pub finished_at: Option<String>,
}

/// 1 エポックの結果(training_epochs と、メトリクスのテーブル)
#[derive(Debug, Clone, PartialEq)]
pub struct EpochRecord {
    pub job_id: JobId,
    /// 終了したエポック数(1 始まり。再開をまたいで続く)
    pub epoch: u32,
    /// NaN や inf は保存されず None
    pub train_loss: Option<f64>,
    pub val_loss: Option<f64>,
    /// このエポックの最後のバッチで使った学習率。0005 より前に記録したエポックは None
    pub learning_rate: Option<f64>,
    pub epoch_elapsed_ms: u64,
    /// メトリクスを記録していないエポックは None
    pub metrics: Option<Metrics>,
}
