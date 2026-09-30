use adapters::GrpcCapabilityProvider;
use tonic::transport::Channel;
use usecases::GetCapabilities;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 接続先は環境変数で切り替える(未設定ならdocker composeのサービス名)
    let addr = std::env::var("AI_ENGINE_ADDR")
        .unwrap_or_else(|_| "http://ai-engine-dev:50051".to_string());

    // C++への接続
    let channel = Channel::from_shared(addr)?.connect_lazy();
    // GrpcCapbilityProviderのインスタンス化
    let provider = GrpcCapabilityProvider::new(channel);
    // Providerをユースケースに渡す
    let get_capabilities = GetCapabilities::new(provider);
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
