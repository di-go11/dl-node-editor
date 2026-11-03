use entities::training::ModelId;
pub enum TrainingMode {
    New,
    Resume { model_id: ModelId },
}
