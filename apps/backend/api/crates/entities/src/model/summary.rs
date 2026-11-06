use super::ModelId;

/// 学習済みモデルの一覧表示用の情報
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelSummary {
    model_id: ModelId,
    model_name: String,
    created_at: String,
}

impl ModelSummary {
    pub fn new(
        model_id: ModelId,
        model_name: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Self {
        Self {
            model_id,
            model_name: model_name.into(),
            created_at: created_at.into(),
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
}
