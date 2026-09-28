fn main() -> Result<(), Box<dyn std::error::Error>> {
    // C++と共有している。apps/backend/proto
    let proto_dir = "../../../proto";
    tonic_prost_build::configure()
        .build_server(false) // Rust側はC++サーバーを呼ぶクライアントのみ
        .compile_protos(
            &[
                format!("{proto_dir}/capabilities.proto"),
                format!("{proto_dir}/training.proto"),
            ],
            &[proto_dir.to_string()],
        )?;
    Ok(())
}
