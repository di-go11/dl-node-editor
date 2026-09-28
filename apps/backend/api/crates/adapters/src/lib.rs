mod error;
mod try_from;

pub use error::ConversionError;

pub mod pb {
    pub mod capabilities {
        pub mod v1 {
            tonic::include_proto!("capabilities.v1");
        }
    }
    pub mod training {
        pub mod v1 {
            tonic::include_proto!("training.v1");
        }
    }
}
