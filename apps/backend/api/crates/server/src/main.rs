use adapters::GrpcCapabilityProvider;
use adapters::GrpcTrainingProgressProvider;
use adapters::GrpcTrainingStarter;
use adapters::GrpcTrainingStopper;
use adapters::connect_database;
use adapters::http::AppState;
use adapters::http::router;
use adapters::training::{recording_channel, run_recording_worker};
use adapters::{SqliteTrainingRepository, UuidModelGenerator};
use entities::training::JobId;
use std::eprintln;
use std::sync::Arc;
use tonic::transport::Channel;
use usecases::capabilities::GetCapabilities;
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
    };

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, router(state)).await?;
    Ok(())
}
