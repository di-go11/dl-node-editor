use adapters::GrpcCapabilityProvider;
use adapters::GrpcTrainingProcessProvider;
use adapters::GrpcTrainingStarter;
use adapters::GrpcTrainingStopper;
use adapters::http::AppState;
use std::sync::Arc;
use tonic::transport::Channel;
use usecases::capabilities::GetCapabilities;
use usecases::training::{GetTrainingProcess, StartTraining, StopTraining};

use adapters::http::router;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 接続先は環境変数で切り替える(未設定ならdocker composeのサービス名)
    let addr = std::env::var("AI_ENGINE_ADDR")
        .unwrap_or_else(|_| "http://ai-engine-dev:50051".to_string());

    // C++への接続
    let channel = Channel::from_shared(addr)?.connect_lazy();
    // アダプターをユースケースに渡して、AppStateにまとめる
    let state = AppState {
        get_capabilities: Arc::new(GetCapabilities::new(GrpcCapabilityProvider::new(
            channel.clone(),
        ))),
        start_training: Arc::new(StartTraining::new(GrpcTrainingStarter::new(
            channel.clone(),
        ))),
        get_process: Arc::new(GetTrainingProcess::new(GrpcTrainingProcessProvider::new(
            channel.clone(),
        ))),
        stop_training: Arc::new(StopTraining::new(GrpcTrainingStopper::new(channel.clone()))),
    };

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, router(state)).await?;
    Ok(())
}
