use super::handler::{
    get_capabilities, get_model_config, get_model_lists, get_training_process, get_training_status,
    read_summary_datasets, resume_training, start_training, stop_training, stream_training_process,
    upload_dataset, validate_training,
};

use super::config::HttpConfig;
use super::state::AppState;
use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use usecases::{
    capabilities::CapabilityProvider,
    dataset::{
        dataset_id_generator::DatasetIdGenerator,
        ports::{
            DatasetFinder, DatasetLayoutChecker, DatasetReader, DatasetRegister, DatasetSaver,
        },
    },
    model::ports::{ModelSummaryProvider, ModelTrainingConfigProvider},
    training::{
        ModelIdGenerator, ProgressRecordingScheduler, TrainingProgressProvider,
        TrainingProgressRecorder, TrainingRecordReader, TrainingResumer, TrainingRunRegistar,
        TrainingStarter, TrainingStopper,
    },
};

pub fn router<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>(
    state: AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    config: HttpConfig,
) -> Router
where
    C: CapabilityProvider + Send + Sync + 'static,
    // S は新規学習(StartTraining)と学習再開(ResumeTraining)で共有する
    S: TrainingStarter + TrainingResumer + Send + Sync + 'static,
    R: TrainingRunRegistar + Send + Sync + 'static,
    G: ModelIdGenerator + Send + Sync + 'static,
    K: ProgressRecordingScheduler + Send + Sync + 'static,
    V: TrainingRecordReader + Send + Sync + 'static,
    P: TrainingProgressProvider + Send + Sync + 'static,
    T: TrainingStopper + Send + Sync + 'static,
    D: TrainingProgressRecorder
        + TrainingRecordReader
        + TrainingRunRegistar
        + Send
        + Sync
        + 'static,
    MSummary: ModelSummaryProvider + Send + Sync + 'static,
    MConfig: ModelTrainingConfigProvider + Send + Sync + 'static,
    // データセットのアップロード(UploadDataset)用
    DG: DatasetIdGenerator + Send + Sync + 'static,
    DS: DatasetSaver + DatasetLayoutChecker + Send + Sync + 'static,
    DR: DatasetRegister + Send + Sync + 'static,
    // データセット一覧(ReadDatasetsSummary)と、学習開始時のデータセットの検索(StartTraining)で共有する
    DRD: DatasetReader + DatasetFinder + Send + Sync + 'static,
{
    Router::new().nest(
        "/api/v1",
        Router::new()
            .route("/capabilities", get(get_capabilities::<C>))
            .route("/trainings", post(start_training::<S, R, G, K, DRD>)) // 学習開始
            .route("/trainings/validate", post(validate_training::<V>))
            .route("/trainings/{job_id}", get(get_training_process::<P>))
            .route(
                "/trainings/{job_id}/progress",
                get(stream_training_process::<P>),
            )
            .route("/trainings/{job_id}/stop", post(stop_training::<T>))
            .route("/trainings/{job_id}/status", get(get_training_status::<P>))
            // 学習済みモデル(学習再開の画面用)
            // TODO: API名を/modelsから/models/listに変更する。
            .route("/models", get(get_model_lists::<MSummary>))
            .route(
                "/models/{model_id}/config",
                get(get_model_config::<MConfig>),
            )
            .route(
                "/models/{model_id}/resume",
                post(resume_training::<MConfig, S, R, K>),
            )
            // データセット呼び出しAPI
            .route("/datasets", get(read_summary_datasets::<DRD>))
            // データセット登録用API
            .route(
                "/datasets/upload",
                post(upload_dataset::<DG, DS, DR>)
                    .layer(DefaultBodyLimit::max(config.max_dataset_upload_bytes())),
            )
            .with_state(state),
    )
}
