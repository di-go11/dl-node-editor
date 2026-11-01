use super::dto::{DataSpecDto, OptimizerConfigDto, StartTrainingResponseDto, TrainingConfigDto};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

// FrontEnd to Backendのハンドラー
#[derive(Debug, Deserialize)]
pub async fn start_training(
    State(state): State<AppState>,
    Json(dto): Json<TrainingConfigDto>,
) -> Result<Json<StartTrainingResponseDto>, StatusCode> {
    let config = TrainingConfig::from(dto);
}
