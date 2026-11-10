use entities::training::config::{Loss, Optimizer, TrainingConfig};

// 学習再開で変えてよい項目だけを持つ入力(issue doc の「学習再開の設計方針」の表)。
// 固定項目(model_name / model_graph / data_spec / seed)は持たせず、ResumeTraining が DB の前回設定の値を使う。
// そのため、クライアントが固定項目を書き換えて送っても C++ には届かない。
#[derive(Debug, PartialEq, Clone)]
pub struct ResumeTrainingConfig {
    pub epoch: u32, // 合計エポック数
    pub batch: u32,
    pub device: String,
    pub dataset_path: String,
    pub optimizer: Optimizer, // 種類は前回と同じであること(execute で確認)
    pub loss: Loss,
    pub save_last_every: u32,
}

impl ResumeTrainingConfig {
    // 前回の設定に、変えてよい項目を上書きする
    pub(crate) fn apply_to(&self, saved: TrainingConfig) -> TrainingConfig {
        TrainingConfig {
            epoch: self.epoch,
            batch: self.batch,
            device: self.device.clone(),
            dataset_path: self.dataset_path.clone(),
            optimizer: self.optimizer.clone(),
            loss: self.loss.clone(),
            save_last_every: self.save_last_every,
            ..saved
        }
    }
}
