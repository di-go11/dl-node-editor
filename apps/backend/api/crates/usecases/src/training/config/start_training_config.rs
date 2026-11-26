use entities::dataset::DatasetId;
use entities::model::ModelGraph;
use entities::training::config::{DataSpec, Loss, Optimizer, TrainingConfig};
use entities::validation::ConfigViolation;

// 新規学習の入力。クライアントはデータセットを ID で指定し、パスは持たない。
// パスは StartTraining が DatasetFinder で ID から引き、TrainingConfig に入れて C++ に送る。
// (クライアントに任意のパスを指定させないため。パスを返さない・受け取らないのは HTTP の DTO も同じ)
// dataset_id は「登録済みデータセットを選ぶ」ための入力の都合なので、ここで使い切る。
// TrainingConfig(C++ に送り、学習の記録として保存する設定)には持ち込まない。
#[derive(Debug, PartialEq, Clone)]
pub struct StartTrainingConfig {
    pub model_name: String,
    pub model_graph: ModelGraph,
    pub epoch: u32,
    pub batch: u32,
    pub device: String,
    pub dataset_id: DatasetId,
    pub optimizer: Optimizer,
    pub loss: Loss,
    pub seed: Option<u64>,
    pub data_spec: DataSpec,
    pub save_last_every: u32,
}

impl StartTrainingConfig {
    // 設定の値を検証する(規則は entities の TrainingConfig::validate)。
    // dataset_path は検証の対象ではないので、データセットを引く前でも呼べるよう空で変換する。
    pub(crate) fn validate(&self) -> Result<(), Vec<ConfigViolation>> {
        self.to_training_config(String::new()).validate()
    }

    // ID から引いたデータセットのパスを足して、C++ に送る学習設定にする
    pub(crate) fn to_training_config(&self, dataset_path: String) -> TrainingConfig {
        TrainingConfig {
            model_name: self.model_name.clone(),
            model_graph: self.model_graph.clone(),
            epoch: self.epoch,
            batch: self.batch,
            device: self.device.clone(),
            dataset_path,
            optimizer: self.optimizer.clone(),
            loss: self.loss.clone(),
            seed: self.seed,
            data_spec: self.data_spec.clone(),
            save_last_every: self.save_last_every,
        }
    }
}
