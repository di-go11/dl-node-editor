fn main() -> Result<(), Box<dyn std::error::Error>> {
    // C++と共有している。apps/backend/proto
    let proto_dir = "../../../proto";
    tonic_prost_build::configure()
        .build_server(false) // Rust側はC++サーバーを呼ぶクライアントのみ
        .compile_protos(
            &[
                format!("{proto_dir}/capabilities.proto"),
                // training.proto が import する(StartTrainingRequest.model_graph)。
                // 明示しておくと、model_graph.proto だけを変えたときも再ビルドされる。
                format!("{proto_dir}/model_graph.proto"),
                format!("{proto_dir}/training.proto"),
            ],
            &[proto_dir.to_string()],
        )?;
    Ok(())
}
