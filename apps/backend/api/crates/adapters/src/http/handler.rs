use super::dto::{
    CapabilitiesDto, StartTrainingResponseDto, TrainingConfigDto, TrainingJobStatusDto,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use entities::training::{config::TrainingConfig, JobId};
use usecases::training::{StartTraining, StopTraining, TrainingStarter, TrainingStopper};
use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    training::StartTrainingError,
};

use std::sync::Arc;

// 学習開始POSTリクエストハンドラ
pub async fn start_training<S>(
    State(usecase): State<Arc<StartTraining<S>>>,
    Json(dto): Json<TrainingConfigDto>,
) -> Result<Json<StartTrainingResponseDto>, StatusCode>
where
    S: TrainingStarter + Send + Sync + 'static,
{
    let config = TrainingConfig::from(dto);
    let job_id = usecase.execute(&config).await.map_err(|e| match e {
        StartTrainingError::StartOrderFailed(_) => StatusCode::BAD_GATEWAY,
        StartTrainingError::ConversionToProtoFailed(_) => StatusCode::UNPROCESSABLE_ENTITY,
    })?;
    Ok(Json(job_id.into()))
}

// デバイス情報取得GETリクエストハンドラ
pub async fn get_capabilities<C>(
    State(usecase): State<Arc<GetCapabilities<C>>>,
) -> Result<Json<CapabilitiesDto>, StatusCode>
where
    C: CapabilityProvider + Send + Sync + 'static,
{
    let capabilities = usecase
        .execute()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    Ok(Json(capabilities.into()))
}

// 学習停止POSTリクエストハンドラ
pub async fn stop_training<T>(
    State(usecase): State<Arc<StopTraining<T>>>,
    Path(job_id): Path<String>,
) -> Result<Json<TrainingJobStatusDto>, StatusCode>
where
    T: TrainingStopper + Send + Sync + 'static,
{
    let job_id = JobId::new(job_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let status = usecase.execute(&job_id).await.map_err(|e| match e {
        usecases::training::StopTrainingError::StopOrderFailed(_) => StatusCode::BAD_GATEWAY,
        usecases::training::StopTrainingError::InvalidResponse(_) => StatusCode::BAD_GATEWAY,
    })?;
    Ok(Json(status.into()))
}
