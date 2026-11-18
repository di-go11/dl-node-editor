use adapters::GrpcCapabilityProvider;
use adapters::GrpcTrainingProgressProvider;
use adapters::GrpcTrainingStarter;
use adapters::GrpcTrainingStopper;
use adapters::connect_database;
use adapters::http::AppState;
use adapters::http::HttpConfig;
use adapters::http::router;
use adapters::training::{recording_channel, run_recording_worker};
use adapters::{FileDatasetSaver, SqliteDatasetRepository, UuidDatasetIdGenerator};
use adapters::{SqliteTrainingRepository, UuidModelGenerator};
use entities::training::JobId;
use std::eprintln;
use std::path::PathBuf;
use std::sync::Arc;
use tonic::transport::Channel;
use usecases::capabilities::GetCapabilities;
use usecases::dataset::read_datasets_summary::ReadDatasetsSummary;
use usecases::dataset::upload_dataset::UploadDataset;
use usecases::model::{GetModelSummary, GetModelTrainingConfig};
use usecases::training::{
    GetTrainingProcess, RecordTrainingProgress, ResumeProgressRecordings, ResumeTraining,
    StartTraining, StopTraining, ValidateTrainingConfig,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 接続先は環境変数で切り替える(未設定ならdocker composeのサービス名)
    let addr = std::env::var("AI_ENGINE_ADDR")
        .unwrap_or_else(|_| "http://ai-engine-dev:50051".to_string());

    // C++への接続
    let channel = Channel::from_shared(addr)?.connect_lazy();
    // Databaseへのconnect
    let database_url = std::env::var("DATABASE_URL")?;
    let pool = connect_database(&database_url).await?;

    // APIでのzipのデータサイズ上限
    let max_dataset_upload_bytes = match std::env::var("DATASET_UPLOAD_MAX_MIB") {
        Ok(v) => v
            .parse::<usize>()
            .map_err(|_| format!("DATASET_UPLOAD_MAX_MIBはMiB単位の整数で指定してください: {v}"))?,
        Err(_) => 10 * 1024,
    }
    .checked_mul(1024 * 1024) //パースしたMiBに1024^2を書けてbyteに変換する。
    .ok_or("DATASET_UPLOAD_MAX_MIBが大きすぎます")?;

    // Zip解凍サイズの上限(FileDatasetSaver が u64 で受け取るので u64 で読む)。未設定なら 1TiB(.deploy/.env と同じ値)
    let max_unzip_max_bytes = match std::env::var("DATASET_UNZIP_MAX_MIB") {
        Ok(v) => v
            .parse::<u64>()
            .map_err(|_| format!("DATASET_UNZIP_MAX_MIBはMiB単位の整数で指定してください: {v}"))?,
        Err(_) => 1024 * 1024,
    }
    .checked_mul(1024 * 1024) //パースしたMiBに1024^2を書けてbyteに変換する。
    .ok_or("DATASET_UNZIP_MAX_MIBが大きすぎます")?;
    // アップロードされたデータセットの解凍先。DBに保存する dataset_path はこの下になり、C++側もそのパスで読むため、
    // 既定値は ai-engine コンテナのマウント先(/datasets)に合わせる
    let dataset_root =
        PathBuf::from(std::env::var("DATASET_ROOT").unwrap_or_else(|_| "/datasets".to_string()));

    // 学習ProgressをDBに保存するためのユースケースにアダブターを渡したのも。
    let training_progress_recorder = Arc::new(RecordTrainingProgress::new(
        GrpcTrainingProgressProvider::new(channel.clone()),
        SqliteTrainingRepository::new(pool.clone()),
    ));
    // 記録の起動依頼を受け取る mpsc チャネル。送信側(scheduler)は StartTraining と起動時の再開で共有する。
    let (scheduler, recording_rx) = recording_channel();
    // 受信ワーカーはサーバーと同じ寿命で動かす(ワーカーが drop されると JoinSet 内の記録タスクも abort されるため)。
    let recorder = Arc::clone(&training_progress_recorder);
    tokio::spawn(run_recording_worker(recording_rx, move |job_id: JobId| {
        // spawnするタスクは'staticである必要があるため、Arcをcloneしてmoveで渡す。
        let recorder = Arc::clone(&recorder);
        async move {
            if let Err(e) = recorder.execute(&job_id).await {
                eprintln!("record failed for {}: {:?}", job_id.as_str(), e);
            }
        }
    }));

    // Rustサーバーが落ちて再起動時に RUNNING のジョブの記録を再開する(新規開始と同じ経路に流すので、二重起動もワーカーが防ぐ)。
    // scheduler は後で StartTraining にも渡すので clone する
    let resumed = ResumeProgressRecordings::new(
        SqliteTrainingRepository::new(pool.clone()),
        scheduler.clone(),
    )
    .execute()
    .await?;
    println!("resumed recording for {resumed} running job(s)");

    // アダプターをユースケースに渡して、AppStateにまとめる
    let state = AppState {
        get_capabilities: Arc::new(GetCapabilities::new(GrpcCapabilityProvider::new(
            channel.clone(),
        ))),
        start_training: Arc::new(StartTraining::new(
            GrpcTrainingStarter::new(channel.clone()),
            SqliteTrainingRepository::new(pool.clone()),
            UuidModelGenerator,
            scheduler.clone(),
            // クライアントが選んだ dataset_id から、C++ に送るパスを引く
            SqliteDatasetRepository::new(pool.clone()),
        )),
        get_process: Arc::new(GetTrainingProcess::new(GrpcTrainingProgressProvider::new(
            channel.clone(),
        ))),
        stop_training: Arc::new(StopTraining::new(GrpcTrainingStopper::new(channel.clone()))),
        validate_training: Arc::new(ValidateTrainingConfig::new(SqliteTrainingRepository::new(
            pool.clone(),
        ))),
        record_training: training_progress_recorder.clone(),
        get_model_summary: Arc::new(GetModelSummary::new(SqliteTrainingRepository::new(
            pool.clone(),
        ))),
        get_model_config: Arc::new(GetModelTrainingConfig::new(SqliteTrainingRepository::new(
            pool.clone(),
        ))),
        // 再開も新規学習と同じ GrpcTrainingStarter(resume = true で送る)と scheduler を使う
        resume_training: Arc::new(ResumeTraining::new(
            SqliteTrainingRepository::new(pool.clone()),
            GrpcTrainingStarter::new(channel.clone()),
            SqliteTrainingRepository::new(pool.clone()),
            scheduler.clone(),
        )),
        // データセットのアップロード(zipを dataset_root に解凍し、メタデータを DB に登録する)
        upload_dataset: Arc::new(UploadDataset::new(
            UuidDatasetIdGenerator,
            FileDatasetSaver::new(dataset_root, max_unzip_max_bytes),
            SqliteDatasetRepository::new(pool.clone()),
        )),
        // データセットのメタデータ一覧取得
        read_dataset_summary: Arc::new(ReadDatasetsSummary::new(SqliteDatasetRepository::new(
            pool.clone(),
        ))),
    };

    // http通信の際の設定
    let http_config = HttpConfig::new(max_dataset_upload_bytes).map_err(|e| e)?;

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, router(state, http_config)).await?;
    Ok(())
}
