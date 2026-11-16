pub mod capabilities;
pub mod database;
mod dataset;
pub mod http;
mod model;
pub mod training;
pub mod utils;

pub use capabilities::GrpcCapabilityProvider;
pub use database::connect_database;
pub use dataset::{FileDatasetSaver, SqliteDatasetRepository, UuidDatasetIdGenerator};
pub use training::GrpcTrainingProgressProvider;
pub use training::GrpcTrainingStarter;
pub use training::GrpcTrainingStopper;
pub use training::SqliteTrainingRepository;
pub use training::UuidModelGenerator;

pub mod pb {
    pub mod capabilities {
        pub mod v1 {
            tonic::include_proto!("capabilities.v1");
        }
    }
    // モジュールの入れ子は proto の package(model.v1 / training.v1)と同じにする。
    // 生成された training.v1 のコードは、ModelGraph を super::super::model::v1 という相対パスで参照するため。
    pub mod model {
        pub mod v1 {
            tonic::include_proto!("model.v1");
        }
    }
    pub mod training {
        pub mod v1 {
            tonic::include_proto!("training.v1");
        }
    }
}
