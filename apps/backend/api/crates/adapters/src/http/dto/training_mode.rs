use entities::training::{ModelId, ModelIdError};
use serde::Deserialize;
use usecases::training::{TrainingMode, TrainingModeKind};

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TrainingModeDto {
    New,
    Resume { model_id: String },
}

impl TryFrom<TrainingModeDto> for TrainingMode {
    type Error = ModelIdError;
    fn try_from(value: TrainingModeDto) -> Result<Self, Self::Error> {
        match value {
            TrainingModeDto::New => Ok(TrainingMode::New),
            TrainingModeDto::Resume { model_id } => Ok(TrainingMode::Resume {
                model_id: ModelId::new(model_id)?,
            }),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TrainingModeKindDto {
    New,
    Resume,
}

// model_idを持たないため変換は失敗しない(TryFromではなくFrom)
impl From<TrainingModeKindDto> for TrainingModeKind {
    fn from(value: TrainingModeKindDto) -> Self {
        match value {
            TrainingModeKindDto::New => TrainingModeKind::New,
            TrainingModeKindDto::Resume => TrainingModeKind::Resume,
        }
    }
}
