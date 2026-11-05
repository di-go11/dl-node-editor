use adapters::GrpcCapabilityProvider;
use adapters::GrpcTrainingProgressProvider;
use adapters::GrpcTrainingStarter;
use adapters::GrpcTrainingStopper;
use adapters::connect_database;
use adapters::http::AppState;
use adapters::http::router;
use adapters::pb::training::v1::TrainingStatus::Running;
use adapters::{SqliteTrainingRepository, UuidModelGenerator};
use std::sync::Arc;
use tonic::transport::Channel;
use usecases::capabilities::GetCapabilities;
use usecases::training::RecordError;
use usecases::training::{
    GetTrainingProcess, RecordTrainingProgress, StartTraining, StopTraining, TrainingRecordReader,
    ValidateTrainingConfig,
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

    // 記録済み学習process
    let record_process = Arc::new(RecordTrainingProgress::new(
        GrpcCapabilityProvider::new(channel.clone()),
        SqliteTrainingRepository::new(pool.clone()),
    ));
    let runnning_jobs = SqliteTrainingRepository::new(pool.clone())
        .find_running_job_ids()
        .await?;
    for job_id in runnning_jobs {
        let record = Arc::clone(&record_process);
        tokio::spawn(async move {})
    }

    // アダプターをユースケースに渡して、AppStateにまとめる
    let state = AppState {
        get_capabilities: Arc::new(GetCapabilities::new(GrpcCapabilityProvider::new(
            channel.clone(),
        ))),
        start_training: Arc::new(StartTraining::new(
            GrpcTrainingStarter::new(channel.clone()),
            SqliteTrainingRepository::new(pool.clone()),
            UuidModelGenerator,
        )),
        get_process: Arc::new(GetTrainingProcess::new(GrpcTrainingProgressProvider::new(
            channel.clone(),
        ))),
        stop_training: Arc::new(StopTraining::new(GrpcTrainingStopper::new(channel.clone()))),
        validate_training: Arc::new(ValidateTrainingConfig::new(SqliteTrainingRepository::new(
            pool.clone(),
        ))),
    };

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, router(state)).await?;
    Ok(())
}
