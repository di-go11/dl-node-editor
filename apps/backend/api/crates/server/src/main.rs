use adapters::GrpcCapabilityProvider;
use adapters::GrpcTrainingProcessProvider;
use adapters::GrpcTrainingStarter;
use adapters::GrpcTrainingStopper;
use tonic::transport::Channel;
use usecases::capabilities::GetCapabilities;
use usecases::training::{GetTrainingProcess, StartTraining, StopTraining};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 接続先は環境変数で切り替える(未設定ならdocker composeのサービス名)
    let addr = std::env::var("AI_ENGINE_ADDR")
        .unwrap_or_else(|_| "http://ai-engine-dev:50051".to_string());

    // C++への接続
    let channel = Channel::from_shared(addr)?.connect_lazy();
    // GrpcCapbilityProviderのインスタンス化
    let capability_provider = GrpcCapabilityProvider::new(channel.clone()); // channelは後でも使うので複製を渡す
    // GrpcTrainingStarterのインスタンス化
    let training_starter = GrpcTrainingStarter::new(channel.clone());
    // GrpcTrainingProcessProviderのインスタンス化
    let training_process_provider = GrpcTrainingProcessProvider::new(channel.clone());
    // GrpcTrainingStopperのインスタンス化
    let training_stopper = GrpcTrainingStopper::new(channel.clone());
    // GrpcCapabilityProviderをユースケースに渡す
    let get_capabilities = GetCapabilities::new(capability_provider);
    // GrpcTrainingStarterをユースケースに渡す。
    let _start_training = StartTraining::new(training_starter);
    // GrpcTrainingProcessProviderをユースケースにわたす。
    let _get_process = GetTrainingProcess::new(training_process_provider);
    // GrpcTrainingStopperをユースケースに渡す。
    let _stop_training = StopTraining::new(training_stopper);
    // ユースケースの実行
    match get_capabilities.execute().await {
        Ok(caps) => {
            println!("cuda available: {}", caps.cuda_available());
            for d in caps.devices() {
                println!("  {:?} #{}: {}", d.device_type, d.index, d.name);
            }
        }
        Err(e) => eprintln!("failed to get capabilities: {e}"),
    }
    Ok(())
}
