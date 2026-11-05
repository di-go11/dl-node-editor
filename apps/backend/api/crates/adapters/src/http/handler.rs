use super::dto::{
    CapabilitiesDto, StartTrainingResponseDto, TrainingConfigDto, TrainingJobStatusDto,
    TrainingProcessDto,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use entities::training::{config::TrainingConfig, JobId, TrainingProcess};
use futures_util::StreamExt;
use usecases::training::{
    GetTrainingProcess, ModelIdGenerator, ProgressRecordingScheduler, StartTraining, StopTraining,
    TrainingProgressProvider, TrainingProgressProviderError,
    TrainingRecordReader, TrainingRunRegistar, TrainingStarter, TrainingStopper,
    ValidateTrainingConfig, ValidateTrainingConfigError,
};
use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    training::StartTrainingError,
};

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_core::Stream;
use std::sync::Arc;
use std::{convert::Infallible, eprint};

// 新規学習の開始POSTリクエストハンドラ(学習再開は別のエンドポイントにする)
// 進捗記録の開始は StartTraining が ProgressRecordingScheduler ポート経由で行うため、ハンドラは関与しない。
// TODO(設計改善): 型パラメータ S, R, G, K は StartTraining の内部依存が漏れたもの。
// 入力ポート(StartTrainingUseCase)を導入して U 1つにする(docs/issues/backend-db-remaining.md 作業12)。
pub async fn start_training<S, R, G, K>(
    State(start): State<Arc<StartTraining<S, R, G, K>>>,
    Json(dto): Json<TrainingConfigDto>,
) -> Result<Json<StartTrainingResponseDto>, StatusCode>
where
    S: TrainingStarter + Send + Sync + 'static,
    R: TrainingRunRegistar + Send + Sync + 'static,
    G: ModelIdGenerator + Send + Sync + 'static,
    K: ProgressRecordingScheduler + Send + Sync + 'static,
{
    let config = TrainingConfig::from(dto);
    let job_id = start.execute(&config).await.map_err(|e| match e {
        StartTrainingError::StartOrderFailed(_) => StatusCode::BAD_GATEWAY,
        StartTrainingError::ConversionToProtoFailed(_) | StartTrainingError::InvalidConfig(_) => {
            StatusCode::UNPROCESSABLE_ENTITY
        }
        StartTrainingError::AlreadyRunning(_) => StatusCode::CONFLICT,
        StartTrainingError::RecordFailed(_) => StatusCode::INTERNAL_SERVER_ERROR,
    })?;
    Ok(Json(job_id.into()))
}

// 新規学習の整合性チェックPOSTリクエストハンドラ(学習開始と同じJSONを受け取る)
pub async fn validate_training<V>(
    State(usecase): State<Arc<ValidateTrainingConfig<V>>>,
    Json(dto): Json<TrainingConfigDto>,
) -> StatusCode
where
    V: TrainingRecordReader + Send + Sync + 'static,
{
    let config = TrainingConfig::from(dto);
    match usecase.execute(&config).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(ValidateTrainingConfigError::ModelNameAlreadyUsed(_)) => StatusCode::CONFLICT,
        Err(ValidateTrainingConfigError::ReadFailed(_)) => StatusCode::INTERNAL_SERVER_ERROR,
    }
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
        usecases::training::StopTrainingError::NotFound(_) => StatusCode::NOT_FOUND,
    })?;
    Ok(Json(status.into()))
}

// 学習状態取得GETリクエストハンドラ
pub async fn get_training_status<T>(
    State(usecase): State<Arc<GetTrainingProcess<T>>>,
    Path(job_id): Path<String>,
) -> Result<Json<TrainingJobStatusDto>, StatusCode>
where
    T: TrainingProgressProvider + Send + Sync + 'static,
{
    let process = fetch_current_process(&usecase, job_id).await?;
    Ok(Json(process.status.into()))
}

// 学習情報取得のGETリクエストハンドラ
pub async fn get_training_process<T>(
    State(usecase): State<Arc<GetTrainingProcess<T>>>,
    Path(job_id): Path<String>,
) -> Result<Json<TrainingProcessDto>, StatusCode>
where
    T: TrainingProgressProvider + Send + Sync + 'static,
{
    let process = fetch_current_process(&usecase, job_id).await?;
    Ok(Json(process.into()))
}

// ストリームの最初の1件だけを読み、その時点の学習情報を返す
async fn fetch_current_process<T>(
    usecase: &GetTrainingProcess<T>,
    job_id: String,
) -> Result<TrainingProcess, StatusCode>
where
    T: TrainingProgressProvider + Send + Sync + 'static,
{
    let job_id = JobId::new(job_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let stream = usecase
        .execute(&job_id)
        .await
        .map_err(status_code_from_provider_error)?;
    let mut stream = std::pin::pin!(stream);
    stream
        .next()
        .await
        .ok_or(StatusCode::BAD_GATEWAY)?
        .map_err(status_code_from_provider_error)
}

fn status_code_from_provider_error(error: TrainingProgressProviderError) -> StatusCode {
    match error {
        TrainingProgressProviderError::NotFound(_) => StatusCode::NOT_FOUND,
        TrainingProgressProviderError::Unavailable(_)
        | TrainingProgressProviderError::InvalidData(_) => StatusCode::BAD_GATEWAY,
    }
}

// 学習情報のストリーミングGETリクエストハンドラ
pub async fn stream_training_process<T>(
    State(usecase): State<Arc<GetTrainingProcess<T>>>,
    Path(job_id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode>
where
    T: TrainingProgressProvider + Send + Sync + 'static,
{
    let job_id = JobId::new(job_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let stream = usecase
        .execute(&job_id)
        .await
        .map_err(status_code_from_provider_error)?;
    // SSE開始後はステータスコードを返せないので、途中のエラーはerrorイベントで送る
    let sse_stream = stream.map(|process_result| {
        let event = match process_result {
            Ok(process) => Event::default()
                .event("progress")
                .json_data(TrainingProcessDto::from(process))
                .unwrap_or_else(|_| {
                    Event::default()
                        .event("error")
                        .data("failed to serialize training process")
                }),
            Err(_) => Event::default()
                .event("error")
                .data("failed to fetch training process"),
        };
        Ok(event)
    });
    Ok(Sse::new(sse_stream).keep_alive(KeepAlive::default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_error_converts_to_404() {
        let error = TrainingProgressProviderError::NotFound("job not found".to_string());
        assert_eq!(
            status_code_from_provider_error(error),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn unavailable_and_invalid_data_errors_convert_to_502() {
        let unavailable = TrainingProgressProviderError::Unavailable("server down".to_string());
        let invalid_data = TrainingProgressProviderError::InvalidData("bad data".to_string());
        assert_eq!(
            status_code_from_provider_error(unavailable),
            StatusCode::BAD_GATEWAY
        );
        assert_eq!(
            status_code_from_provider_error(invalid_data),
            StatusCode::BAD_GATEWAY
        );
    }
}
