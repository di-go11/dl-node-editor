use super::dto::{
    CapabilitiesDto, ModelSummariesDto, ModelTrainingConfigDto, ResumeTrainingConfigDto,
    StartTrainingResponseDto, TrainingConfigDto, TrainingJobStatusDto, TrainingProcessDto,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use entities::{
    model::ModelId,
    training::{config::TrainingConfig, JobId, TrainingProcess},
};
use futures_util::StreamExt;
use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    dataset::{
        dataset_id_generator::DatasetIdGenerator,
        error::DatasetError,
        ports::{DatasetRegister, DatasetSaver},
        upload_dataset::UploadDataset,
    },
    model::{
        error::{FetchModelError, ModelRepositoryError},
        ports::{ModelSummaryProvider, ModelTrainingConfigProvider},
        GetModelSummary, GetModelTrainingConfig,
    },
    training::{
        GetTrainingProcess, ModelIdGenerator, ProgressRecordingScheduler, ResumeTraining,
        ResumeTrainingConfig, ResumeTrainingError, StartTraining, StartTrainingError, StopTraining,
        TrainingProgressProvider, TrainingProgressProviderError, TrainingRecordReader,
        TrainingResumer, TrainingRunRegistar, TrainingStarter, TrainingStopper,
        ValidateTrainingConfig, ValidateTrainingConfigError,
    },
};

use crate::utils::uuid_generator::generate_uuid;
use axum::extract::Multipart;
use tokio::io::AsyncWriteExt;

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_core::Stream;
use std::convert::Infallible;
use std::sync::Arc;

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
    let job_id = start
        .execute(&config)
        .await
        .map_err(status_code_from_start_error)?;
    Ok(Json(job_id.into()))
}

// 新規学習と学習再開で共通の、C++での学習開始・記録の失敗の変換
fn status_code_from_start_error(error: StartTrainingError) -> StatusCode {
    match error {
        StartTrainingError::StartOrderFailed(_) => StatusCode::BAD_GATEWAY,
        StartTrainingError::ConversionToProtoFailed(_)
        | StartTrainingError::InvalidConfig(_)
        | StartTrainingError::ResumePreconditionFailed(_) => StatusCode::CONFLICT,
        StartTrainingError::AlreadyRunning(_) => StatusCode::CONFLICT,
        StartTrainingError::RecordFailed(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
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

// 学習済みモデルの一覧取得GETリクエストハンドラ。0件でも 200 で空の一覧を返す
pub async fn get_model_lists<S>(
    State(usecase): State<Arc<GetModelSummary<S>>>,
) -> Result<Json<ModelSummariesDto>, StatusCode>
where
    S: ModelSummaryProvider + Send + Sync + 'static,
{
    let model_summaries = usecase
        .get_summary()
        .await
        .map_err(status_code_from_model_error)?;
    Ok(Json(ModelSummariesDto::from(model_summaries.as_slice())))
}

// 学習済みモデルの最新の学習設定取得GETリクエストハンドラ(再開フォームの初期値と固定項目の表示用)
// 再開リクエスト(ResumeTrainingConfigDto)には、この応答のうち変えてよい項目だけを送る
pub async fn get_model_config<T>(
    State(usecase): State<Arc<GetModelTrainingConfig<T>>>,
    Path(model_id): Path<String>,
) -> Result<Json<ModelTrainingConfigDto>, StatusCode>
where
    T: ModelTrainingConfigProvider + Send + Sync + 'static,
{
    let model_id = ModelId::new(model_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let config = usecase
        .get_config(&model_id)
        .await
        .map_err(status_code_from_model_error)?;
    Ok(Json(ModelTrainingConfigDto {
        model_id: model_id.as_str().to_string(),
        config: config.into(),
    }))
}

fn status_code_from_model_error(error: ModelRepositoryError) -> StatusCode {
    match error {
        ModelRepositoryError::Fetch(FetchModelError::NotFound(_)) => StatusCode::NOT_FOUND,
        // 構造が保存されていない古いモデルは再開できない
        ModelRepositoryError::Fetch(FetchModelError::GraphNotSaved(_)) => StatusCode::CONFLICT,
        // どちらもクライアントの誤りではなく、サーバー側(DB)の問題
        ModelRepositoryError::Fetch(
            FetchModelError::InvalidQuery(_) | FetchModelError::InvalidData(_),
        ) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// 学習再開POSTリクエストハンドラ。本体は再開時に変えてよい項目だけ(固定項目は ResumeTraining が DB から使う)
// TODO(設計改善): 型パラメータは作業12(入力ポート)で U 1つにする。
pub async fn resume_training<C, S, R, K>(
    State(usecase): State<Arc<ResumeTraining<C, S, R, K>>>,
    Path(model_id): Path<String>,
    Json(dto): Json<ResumeTrainingConfigDto>,
) -> Result<Json<StartTrainingResponseDto>, StatusCode>
where
    C: ModelTrainingConfigProvider + Send + Sync + 'static,
    S: TrainingResumer + Send + Sync + 'static,
    R: TrainingRunRegistar + Send + Sync + 'static,
    K: ProgressRecordingScheduler + Send + Sync + 'static,
{
    let model_id = ModelId::new(model_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let input = ResumeTrainingConfig::from(dto);
    let job_id = usecase
        .execute(&model_id, &input)
        .await
        .map_err(|e| match e {
            ResumeTrainingError::ModelNotFound(_) => StatusCode::NOT_FOUND,
            ResumeTrainingError::NotResumable(_) => StatusCode::CONFLICT,
            ResumeTrainingError::ReadFailed(_) => StatusCode::INTERNAL_SERVER_ERROR,
            ResumeTrainingError::OptimizerTypeChanged(_) => StatusCode::UNPROCESSABLE_ENTITY,
            ResumeTrainingError::Start(e) => status_code_from_start_error(e),
        })?;
    Ok(Json(job_id.into()))
}

// データセットのアップロードPOSTリクエストハンドラ。
// multipart/form-data で file(zip)・name・type を受け取り、zip を一時ファイルに書き出してから UploadDataset に渡す。
// 解凍・配置とメタデータ登録は UploadDataset(DatasetSaver / DatasetRegister)の仕事で、ハンドラは関与しない。
pub async fn upload_dataset<G, S, R>(
    State(usecase): State<Arc<UploadDataset<G, S, R>>>,
    multipart: Multipart,
) -> StatusCode
where
    G: DatasetIdGenerator + Send + Sync + 'static,
    S: DatasetSaver + Send + Sync + 'static,
    R: DatasetRegister + Send + Sync + 'static,
{
    // TODO: /tmp はコンテナでは tmpfs(メモリ上)のことがある。dataset_root と同じディスク上の置き場を設定で渡す
    let zip_path = std::env::temp_dir().join(format!("dataset-upload-{}.zip", generate_uuid()));
    let result = receive_and_upload(&usecase, multipart, &zip_path).await;
    // 成功・失敗に関わらず一時zipは消す(解凍済みのデータは dataset_root 側に残っている)
    let _ = tokio::fs::remove_file(&zip_path).await;
    match result {
        Ok(()) => StatusCode::CREATED,
        Err(code) => code,
    }
}

// multipart を読み、zip を zip_path に書き出してから UploadDataset を実行する
async fn receive_and_upload<G, S, R>(
    usecase: &UploadDataset<G, S, R>,
    mut multipart: Multipart,
    zip_path: &std::path::Path,
) -> Result<(), StatusCode>
where
    G: DatasetIdGenerator + Send + Sync + 'static,
    S: DatasetSaver + Send + Sync + 'static,
    R: DatasetRegister + Send + Sync + 'static,
{
    let mut name = None;
    let mut dataset_type = None;
    let mut has_file = false;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
    {
        // field.name() は field を借用するので、chunk() で &mut を使う前に String にしておく
        let field_name = field.name().map(str::to_owned);
        match field_name.as_deref() {
            Some("file") => {
                let mut file = tokio::fs::File::create(zip_path)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                // bytes() は全体をメモリに載せるので、チャンクごとにディスクへ書く
                while let Some(chunk) = field.chunk().await.map_err(|_| StatusCode::BAD_REQUEST)? {
                    file.write_all(&chunk)
                        .await
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
                file.flush()
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                has_file = true;
            }
            Some("name") => name = Some(field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?),
            Some("type") => {
                dataset_type = Some(field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?)
            }
            _ => {} // 知らない項目は読み飛ばす
        }
    }

    // 3項目のどれかが欠けている、または名前・種類が空ならクライアントの誤り
    let (Some(name), Some(dataset_type), true) = (name, dataset_type, has_file) else {
        return Err(StatusCode::BAD_REQUEST);
    };
    if name.trim().is_empty() || dataset_type.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // TODO: 壊れたzip(クライアントの誤り → 400/422)とディスク障害(500)を区別するには、
    // DatasetError に InvalidArchive のような種類を足す必要がある。今はすべて 500 にしている。
    usecase
        .execute(zip_path, name, dataset_type)
        .await
        .map_err(|e| match e {
            DatasetError::SaveFailed(_)
            | DatasetError::RegisterFailed(_)
            | DatasetError::CallFailed(_)
            | DatasetError::ReadFailed(_) => StatusCode::INTERNAL_SERVER_ERROR,
        })
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
