use super::dto::{
    CapabilitiesDto, DatasetLayoutMismatchDto, DatasetSummariesDto, ErrorCode, ErrorCodeDto,
    InvalidConfigDto, ModelHistoryDto, ModelSummariesDto, ModelTrainingConfigDto,
    ResumeTrainingConfigDto, StartTrainingResponseDto, TrainingConfigDto, TrainingJobStatusDto,
    TrainingProcessDto,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use entities::{
    model::ModelId,
    training::{JobId, TrainingProcess},
    validation::ConfigViolation,
};
use futures_util::StreamExt;
use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    dataset::{
        dataset_id_generator::DatasetIdGenerator,
        error::DatasetError,
        ports::{
            DatasetFinder, DatasetLayoutChecker, DatasetReader, DatasetRegister, DatasetSaver,
        },
        read_datasets_summary::ReadDatasetsSummary,
        upload_dataset::UploadDataset,
    },
    model::{
        error::{FetchModelError, ModelRepositoryError},
        ports::{ModelHistoryProvider, ModelSummaryProvider, ModelTrainingConfigProvider},
        GetModelHistory, GetModelSummary, GetModelTrainingConfig,
    },
    training::{
        GetTrainingProcess, ModelGraphValidator, ModelGraphValidatorError, ModelIdGenerator,
        ProgressRecordingScheduler, ResumeTraining, ResumeTrainingConfig, ResumeTrainingError,
        StartTraining, StartTrainingConfig, StartTrainingError, StopTraining,
        TrainingProgressProvider, TrainingProgressProviderError, TrainingRecordReader,
        TrainingResumer, TrainingRunRegistar, TrainingStarter, TrainingStopper,
        ValidateTrainingConfig, ValidateTrainingConfigError,
    },
};

use crate::utils::uuid_generator::generate_uuid;
use axum::extract::Multipart;
use axum::response::{IntoResponse, Response};
use tokio::io::AsyncWriteExt;

use axum::response::sse::{Event, KeepAlive, Sse};
use futures_core::Stream;
use std::convert::Infallible;
use std::sync::Arc;

// 新規学習の開始POSTリクエストハンドラ(学習再開は別のエンドポイントにする)
// 進捗記録の開始は StartTraining が ProgressRecordingScheduler ポート経由で行うため、ハンドラは関与しない。
// データセットは dataset_id で受け取り、パスは StartTraining が DB から引く(クライアントにパスを指定させない)。
// TODO(設計改善): 型パラメータ S, R, G, K, F は StartTraining の内部依存が漏れたもの。
// 入力ポート(StartTrainingUseCase)を導入して U 1つにする(docs/issues/backend-db-remaining.md 作業12)。
pub async fn start_training<S, R, G, K, F>(
    State(start): State<Arc<StartTraining<S, R, G, K, F>>>,
    Json(dto): Json<TrainingConfigDto>,
) -> Result<Json<StartTrainingResponseDto>, Response>
where
    // 学習の開始と、開始前のグラフの検証の両方に使う
    S: TrainingStarter + ModelGraphValidator + Send + Sync + 'static,
    R: TrainingRunRegistar + Send + Sync + 'static,
    G: ModelIdGenerator + Send + Sync + 'static,
    K: ProgressRecordingScheduler + Send + Sync + 'static,
    F: DatasetFinder + Send + Sync + 'static,
{
    // 空の dataset_id はクライアントの誤り
    let config = StartTrainingConfig::try_from(dto).map_err(|_| invalid_request_response())?;
    let job_id = start
        .execute(&config)
        .await
        .map_err(response_from_start_error)?;
    Ok(Json(job_id.into()))
}

// 学習設定の違反を 422 と違反の一覧(本文)にする。学習開始・再開・整合性チェックで共通
fn invalid_config_response(violations: Vec<ConfigViolation>) -> Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(InvalidConfigDto::from(violations)),
    )
        .into_response()
}

// 違反の一覧のない 422 などに、原因のコードを本文で付ける。同じ状態コードでも原因が違うものを、
// フロントが文言で区別できるようにする(データセットがない / 色表が読めない / リクエストの中身)
fn error_code_response(status: StatusCode, code: ErrorCode) -> Response {
    (status, Json(ErrorCodeDto { error: code })).into_response()
}

// リクエストの中身が受け付けられない(空の dataset_id など)
fn invalid_request_response() -> Response {
    error_code_response(StatusCode::UNPROCESSABLE_ENTITY, ErrorCode::InvalidRequest)
}

// 新規学習と学習再開で共通の、学習開始・記録の失敗の変換。
// 設定の違反は違反の一覧、データセットの問題は原因のコードを本文に付ける
fn response_from_start_error(error: StartTrainingError) -> Response {
    match error {
        StartTrainingError::InvalidConfig(violations) => invalid_config_response(violations),
        StartTrainingError::DatasetNotFound(_) => {
            error_code_response(StatusCode::UNPROCESSABLE_ENTITY, ErrorCode::DatasetNotFound)
        }
        // 学習開始前のグラフの検証(ValidateModelGraph)と、学習開始の時点(StartTraining)の両方
        StartTrainingError::DatasetUnreadable(_)
        | StartTrainingError::GraphCheckFailed(ModelGraphValidatorError::DatasetUnreadable(_)) => {
            error_code_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorCode::DatasetUnreadable,
            )
        }
        // 学習開始の時点で C++ が見つけたグラフの問題も、設定の違反と同じ本文で返す。
        // C++ のメッセージにノードと内容が並んでいるので、グラフ全体(model_graph)の違反 1 件にする
        StartTrainingError::ModelGraphMismatch(message) => {
            invalid_config_response(vec![ConfigViolation {
                field: "model_graph".to_string(),
                message,
            }])
        }
        other => status_code_from_start_error(other).into_response(),
    }
}

fn status_code_from_start_error(error: StartTrainingError) -> StatusCode {
    match error {
        StartTrainingError::StartOrderFailed(_) => StatusCode::BAD_GATEWAY,
        StartTrainingError::ResumePreconditionFailed(_) | StartTrainingError::AlreadyRunning(_) => {
            StatusCode::CONFLICT
        }
        // 設定の誤りは Rust の検証で先に返すので、proto への変換の失敗や C++ の INVALID_ARGUMENT は
        // Rust 側のバグ(検証漏れ)。クライアントの誤りではないので 500 にする
        StartTrainingError::ConversionToProtoFailed(_)
        | StartTrainingError::EngineRejectedConfig(_)
        | StartTrainingError::RecordFailed(_)
        | StartTrainingError::DatasetReadFailed(_) => StatusCode::INTERNAL_SERVER_ERROR,
        // 本体で指定されたデータセットがない(URL のリソースがないわけではないので 404 ではなく 422)。
        // グラフがデータセットに合わない・データセットが読めないのも、選んだ設定・データセットの問題なので 422
        StartTrainingError::DatasetNotFound(_)
        | StartTrainingError::InvalidConfig(_)
        | StartTrainingError::ModelGraphMismatch(_)
        | StartTrainingError::DatasetUnreadable(_) => StatusCode::UNPROCESSABLE_ENTITY,
        StartTrainingError::GraphCheckFailed(e) => status_code_from_graph_check_error(&e),
    }
}

// C++ でのグラフの検証ができなかったときの変換(学習開始と整合性チェックで共通)
fn status_code_from_graph_check_error(error: &ModelGraphValidatorError) -> StatusCode {
    match error {
        ModelGraphValidatorError::CallFailed(_) => StatusCode::BAD_GATEWAY,
        // データセットの色表(labelmap.txt)が読めない。クライアントが選んだデータセットの問題なので 422
        ModelGraphValidatorError::DatasetUnreadable(_) => StatusCode::UNPROCESSABLE_ENTITY,
        // C++ が依頼を拒否した(Rust の検証漏れ)、または C++ の内部の失敗
        ModelGraphValidatorError::Rejected(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// 新規学習の整合性チェックPOSTリクエストハンドラ(学習開始と同じJSONを受け取る)
pub async fn validate_training<V, M, F>(
    State(usecase): State<Arc<ValidateTrainingConfig<V, M, F>>>,
    Json(dto): Json<TrainingConfigDto>,
) -> Response
where
    V: TrainingRecordReader + Send + Sync + 'static,
    M: ModelGraphValidator + Send + Sync + 'static,
    F: DatasetFinder + Send + Sync + 'static,
{
    let Ok(config) = StartTrainingConfig::try_from(dto) else {
        return invalid_request_response(); // 空の dataset_id
    };
    match usecase.execute(&config).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => response_from_validate_error(error),
    }
}

fn response_from_validate_error(error: ValidateTrainingConfigError) -> Response {
    match error {
        ValidateTrainingConfigError::InvalidConfig(violations) => {
            invalid_config_response(violations)
        }
        ValidateTrainingConfigError::ModelNameAlreadyUsed(_) => {
            StatusCode::CONFLICT.into_response()
        }
        // データセットの問題は、学習開始と同じく 422 と原因のコード
        ValidateTrainingConfigError::DatasetNotFound(_) => {
            error_code_response(StatusCode::UNPROCESSABLE_ENTITY, ErrorCode::DatasetNotFound)
        }
        ValidateTrainingConfigError::GraphCheckFailed(
            ModelGraphValidatorError::DatasetUnreadable(_),
        ) => error_code_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::DatasetUnreadable,
        ),
        ValidateTrainingConfigError::ReadFailed(_)
        | ValidateTrainingConfigError::DatasetReadFailed(_) => {
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        ValidateTrainingConfigError::GraphCheckFailed(e) => {
            status_code_from_graph_check_error(&e).into_response()
        }
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

// 学習済みモデルの学習の記録GETリクエストハンドラ(全 run のエポックごとの loss・学習率・メトリクス)。
// フロントがこれから loss・学習率のグラフ(SVG)とメトリクスの表(CSV)を作る
pub async fn get_model_history<H>(
    State(usecase): State<Arc<GetModelHistory<H>>>,
    Path(model_id): Path<String>,
) -> Result<Json<ModelHistoryDto>, StatusCode>
where
    H: ModelHistoryProvider + Send + Sync + 'static,
{
    let model_id = ModelId::new(model_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let history = usecase
        .get_history(&model_id)
        .await
        .map_err(status_code_from_model_error)?;
    Ok(Json(history.into()))
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
) -> Result<Json<StartTrainingResponseDto>, Response>
where
    C: ModelTrainingConfigProvider + Send + Sync + 'static,
    S: TrainingResumer + Send + Sync + 'static,
    R: TrainingRunRegistar + Send + Sync + 'static,
    K: ProgressRecordingScheduler + Send + Sync + 'static,
{
    let model_id = ModelId::new(model_id).map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    let input = ResumeTrainingConfig::from(dto);
    let job_id = usecase
        .execute(&model_id, &input)
        .await
        .map_err(response_from_resume_error)?;
    Ok(Json(job_id.into()))
}

fn response_from_resume_error(error: ResumeTrainingError) -> Response {
    match error {
        ResumeTrainingError::InvalidConfig(violations) => invalid_config_response(violations),
        ResumeTrainingError::Start(e) => response_from_start_error(e),
        ResumeTrainingError::ModelNotFound(_) => StatusCode::NOT_FOUND.into_response(),
        ResumeTrainingError::NotResumable(_) => StatusCode::CONFLICT.into_response(),
        ResumeTrainingError::ReadFailed(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        ResumeTrainingError::OptimizerTypeChanged(_) => {
            StatusCode::UNPROCESSABLE_ENTITY.into_response()
        }
    }
}

// データセットのアップロードPOSTリクエストハンドラ。
// multipart/form-data で file(zip)・name・type を受け取り、zip を一時ファイルに書き出してから UploadDataset に渡す。
// 解凍・配置・形式に合うかの確認とメタデータ登録は UploadDataset の仕事で、ハンドラは関与しない。
// 形式に合わなければ 422 で、足りないファイル・ディレクトリを本文(DatasetLayoutMismatchDto)で返す。
pub async fn upload_dataset<G, S, R>(
    State(usecase): State<Arc<UploadDataset<G, S, R>>>,
    multipart: Multipart,
) -> Response
where
    G: DatasetIdGenerator + Send + Sync + 'static,
    S: DatasetSaver + DatasetLayoutChecker + Send + Sync + 'static,
    R: DatasetRegister + Send + Sync + 'static,
{
    // TODO: /tmp はコンテナでは tmpfs(メモリ上)のことがある。dataset_root と同じディスク上の置き場を設定で渡す
    let zip_path = std::env::temp_dir().join(format!("dataset-upload-{}.zip", generate_uuid()));
    let result = receive_and_upload(&usecase, multipart, &zip_path).await;
    // 成功・失敗に関わらず一時zipは消す(解凍済みのデータは dataset_root 側に残っている)
    let _ = tokio::fs::remove_file(&zip_path).await;
    match result {
        Ok(()) => StatusCode::CREATED.into_response(),
        Err(response) => response,
    }
}

// アップロードの失敗を応答にする。形式に合わないときだけ本文を付ける
fn response_from_upload_error(error: DatasetError) -> Response {
    match error {
        DatasetError::LayoutMismatch { format, missing } => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(DatasetLayoutMismatchDto { format, missing }),
        )
            .into_response(),
        DatasetError::UnknownFormat(_) => StatusCode::BAD_REQUEST.into_response(),
        DatasetError::SaveFailed(_)
        | DatasetError::RegisterFailed(_)
        | DatasetError::CallFailed(_)
        | DatasetError::ReadFailed(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// multipart を読み、zip を zip_path に書き出してから UploadDataset を実行する
async fn receive_and_upload<G, S, R>(
    usecase: &UploadDataset<G, S, R>,
    multipart: Multipart,
    zip_path: &std::path::Path,
) -> Result<(), Response>
where
    G: DatasetIdGenerator + Send + Sync + 'static,
    S: DatasetSaver + DatasetLayoutChecker + Send + Sync + 'static,
    R: DatasetRegister + Send + Sync + 'static,
{
    let (name, dataset_type) = receive_upload(multipart, zip_path)
        .await
        .map_err(IntoResponse::into_response)?;

    // TODO: 壊れたzip(クライアントの誤り → 400/422)とディスク障害(500)を区別するには、
    // DatasetError に InvalidArchive のような種類を足す必要がある。今はすべて 500 にしている。
    usecase
        .execute(zip_path, name, dataset_type)
        .await
        .map_err(response_from_upload_error)
}

// multipart を読んで zip を zip_path に書き出し、名前と形式を返す
async fn receive_upload(
    mut multipart: Multipart,
    zip_path: &std::path::Path,
) -> Result<(String, String), StatusCode> {
    let mut name = None;
    let mut dataset_type = None;
    let mut has_file = false;

    while let Some(mut field) = multipart.next_field().await.map_err(|e| e.status())?
    // 上限を超えた際に413を返す。
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
    Ok((name, dataset_type))
}

// DBからデータセットのメタデータ一覧を呼び出すGETリクエストハンドラ
pub async fn read_summary_datasets<R>(
    State(usecase): State<Arc<ReadDatasetsSummary<R>>>,
) -> Result<Json<DatasetSummariesDto>, StatusCode>
where
    R: DatasetReader + Send + Sync + 'static,
{
    // 一覧の読み取りでは形式の誤り(UnknownFormat / LayoutMismatch)は起きないが、起きても DB 側の問題として扱う
    let summary = usecase.execute().await.map_err(|e| match e {
        DatasetError::SaveFailed(_)
        | DatasetError::RegisterFailed(_)
        | DatasetError::CallFailed(_)
        | DatasetError::ReadFailed(_)
        | DatasetError::UnknownFormat(_)
        | DatasetError::LayoutMismatch { .. } => StatusCode::INTERNAL_SERVER_ERROR,
    })?;
    Ok(Json(DatasetSummariesDto::from(summary.as_slice())))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 形式に合わない zip は 422 で、足りないものを本文で返す
    #[tokio::test]
    async fn layout_mismatch_converts_to_422_with_missing_entries() {
        let response = response_from_upload_error(DatasetError::LayoutMismatch {
            format: "original".to_string(),
            missing: vec!["JPEGImages/".to_string(), "labelmap.txt".to_string()],
        });
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({
                "format": "original",
                "missing": ["JPEGImages/", "labelmap.txt"]
            })
        );
    }

    async fn body_json(response: Response) -> serde_json::Value {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    fn violations() -> Vec<ConfigViolation> {
        vec![
            ConfigViolation {
                field: "optimizer.learning_rate".to_string(),
                message: "0 より大きくしてください(0)".to_string(),
            },
            ConfigViolation {
                field: "model_graph.nodes[3].spec.stride".to_string(),
                message: "1 以上にしてください(0)".to_string(),
            },
        ]
    }

    fn expected_invalid_config_body() -> serde_json::Value {
        serde_json::json!({
            "error": "invalid_config",
            "violations": [
                { "field": "optimizer.learning_rate", "message": "0 より大きくしてください(0)" },
                { "field": "model_graph.nodes[3].spec.stride", "message": "1 以上にしてください(0)" }
            ]
        })
    }

    // 設定の違反は 422 で、違反をすべて本文で返す
    #[tokio::test]
    async fn invalid_config_on_start_converts_to_422_with_violations() {
        let response = response_from_start_error(StartTrainingError::InvalidConfig(violations()));
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body_json(response).await, expected_invalid_config_body());
    }

    // 再開でも同じ形(ResumeTrainingError 自身の違反と、Start に包まれた違反の両方)
    #[tokio::test]
    async fn invalid_config_on_resume_converts_to_422_with_violations() {
        let errors = [
            ResumeTrainingError::InvalidConfig(violations()),
            ResumeTrainingError::Start(StartTrainingError::InvalidConfig(violations())),
        ];
        for error in errors {
            let response = response_from_resume_error(error);
            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(body_json(response).await, expected_invalid_config_body());
        }
    }

    // C++ が設定を拒否した・proto に変換できなかったのは Rust の検証漏れなので 500
    #[test]
    fn engine_rejection_and_conversion_failure_convert_to_500() {
        let errors = [
            StartTrainingError::EngineRejectedConfig("lr".to_string()),
            StartTrainingError::ConversionToProtoFailed("graph".to_string()),
        ];
        for error in errors {
            assert_eq!(
                response_from_start_error(error).status(),
                StatusCode::INTERNAL_SERVER_ERROR
            );
        }
    }

    // C++ でのグラフの検証ができなかったとき: 通信できない 502、データセットが読めない 422、拒否 500
    #[test]
    fn graph_check_failure_converts_by_cause() {
        let cases = [
            (
                ModelGraphValidatorError::CallFailed("down".to_string()),
                StatusCode::BAD_GATEWAY,
            ),
            (
                ModelGraphValidatorError::DatasetUnreadable("labelmap.txt".to_string()),
                StatusCode::UNPROCESSABLE_ENTITY,
            ),
            (
                ModelGraphValidatorError::Rejected("stride".to_string()),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(
                response_from_start_error(StartTrainingError::GraphCheckFailed(error.clone()))
                    .status(),
                expected
            );
            assert_eq!(
                response_from_validate_error(ValidateTrainingConfigError::GraphCheckFailed(error))
                    .status(),
                expected
            );
        }
    }

    // 学習開始の時点で C++ が見つけたグラフの問題は、model_graph の違反 1 件の本文にする。
    // 再開の条件(409)・データセットが読めない(422、本文なし)とは区別する
    #[tokio::test]
    async fn start_errors_from_engine_are_split_by_cause() {
        let response = response_from_start_error(StartTrainingError::ModelGraphMismatch(
            "ノード 'head': クラス数と一致しません".to_string(),
        ));
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body_json(response).await,
            serde_json::json!({
                "error": "invalid_config",
                "violations": [
                    { "field": "model_graph", "message": "ノード 'head': クラス数と一致しません" }
                ]
            })
        );

        assert_eq!(
            response_from_start_error(StartTrainingError::DatasetUnreadable(
                "labelmap.txt".to_string()
            ))
            .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            response_from_start_error(StartTrainingError::ResumePreconditionFailed(
                "checkpoint".to_string()
            ))
            .status(),
            StatusCode::CONFLICT
        );
    }

    // 整合性チェックの違反も、学習開始と同じ 422 と本文
    #[tokio::test]
    async fn invalid_config_on_validate_converts_to_422_with_violations() {
        let response =
            response_from_validate_error(ValidateTrainingConfigError::InvalidConfig(violations()));
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body_json(response).await, expected_invalid_config_body());
    }

    #[test]
    fn dataset_errors_on_validate_convert_like_start() {
        assert_eq!(
            response_from_validate_error(ValidateTrainingConfigError::DatasetNotFound(
                "dataset-1".to_string()
            ))
            .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            response_from_validate_error(ValidateTrainingConfigError::DatasetReadFailed(
                "db locked".to_string()
            ))
            .status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    // 違反の一覧のない 422 は、原因のコードを本文に付ける(フロントが文言を分けるため)
    #[tokio::test]
    async fn dataset_and_request_problems_return_error_codes() {
        let unreadable = || ModelGraphValidatorError::DatasetUnreadable("labelmap.txt".to_string());
        let cases = [
            (
                response_from_start_error(StartTrainingError::DatasetNotFound("d".to_string())),
                "dataset_not_found",
            ),
            (
                response_from_start_error(StartTrainingError::DatasetUnreadable("l".to_string())),
                "dataset_unreadable",
            ),
            (
                response_from_start_error(StartTrainingError::GraphCheckFailed(unreadable())),
                "dataset_unreadable",
            ),
            (
                response_from_validate_error(ValidateTrainingConfigError::DatasetNotFound(
                    "d".to_string(),
                )),
                "dataset_not_found",
            ),
            (
                response_from_validate_error(ValidateTrainingConfigError::GraphCheckFailed(
                    unreadable(),
                )),
                "dataset_unreadable",
            ),
            (invalid_request_response(), "invalid_request"),
        ];
        for (response, code) in cases {
            assert_eq!(
                response.status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "{code}"
            );
            assert_eq!(
                body_json(response).await,
                serde_json::json!({ "error": code })
            );
        }
    }

    #[test]
    fn unknown_format_converts_to_400() {
        let response = response_from_upload_error(DatasetError::UnknownFormat("coco".to_string()));
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

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
