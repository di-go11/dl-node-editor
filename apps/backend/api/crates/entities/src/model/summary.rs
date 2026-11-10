use super::ModelId;
use crate::training::TrainingJobStatus;

/// 学習済みモデルの一覧表示用の情報(学習再開の画面で使う)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelSummary {
    model_id: ModelId,
    model_name: String,
    created_at: String,
    task_type: ModelTaskType,
    last_run: LastRunSummary,
    completed_epochs: u32,
    resumable: bool,
}

/// モデルのタスク(最新の run の data_spec から取る)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelTaskType {
    Segmentation,
    Classification,
}

/// そのモデルの最新の run の状態
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LastRunSummary {
    pub status: TrainingJobStatus,
    pub started_at: String,
    /// 終了を記録できていなければ None(学習中、または記録前に Rust が止まった)
    pub finished_at: Option<String>,
}

impl ModelSummary {
    pub fn new(
        model_id: ModelId,
        model_name: impl Into<String>,
        created_at: impl Into<String>,
        task_type: ModelTaskType,
        last_run: LastRunSummary,
        completed_epochs: u32,
        resumable: bool,
    ) -> Self {
        Self {
            model_id,
            model_name: model_name.into(),
            created_at: created_at.into(),
            task_type,
            last_run,
            completed_epochs,
            resumable,
        }
    }
    pub fn model_id(&self) -> &ModelId {
        &self.model_id
    }
    pub fn model_name(&self) -> &str {
        &self.model_name
    }
    pub fn created_at(&self) -> &str {
        &self.created_at
    }
    pub fn task_type(&self) -> ModelTaskType {
        self.task_type
    }
    pub fn last_run(&self) -> &LastRunSummary {
        &self.last_run
    }
    /// そのモデルの全 run を通して記録された完了エポック数(epoch は 0 始まりなので、最大値 + 1)。
    /// save_last_every > 1 だと checkpoint はこれより前のエポックのことがある(issue doc 作業 5 の注意)
    pub fn completed_epochs(&self) -> u32 {
        self.completed_epochs
    }
    /// 再開できるか(モデル構造が保存されているか)
    pub fn resumable(&self) -> bool {
        self.resumable
    }
}
