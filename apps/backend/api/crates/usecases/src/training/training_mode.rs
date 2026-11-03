use entities::training::ModelId;
// 学習開始用
pub enum TrainingMode {
    New,
    Resume { model_id: ModelId },
}
// 整合性チェック用
pub enum TrainingModeKind {
    New,
    Resume,
}
