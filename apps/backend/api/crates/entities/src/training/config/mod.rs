mod data_spec;
mod stop_training;
mod training_config;

pub use data_spec::{
    DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, PascalVocConfig, SegmentationSpec,
};

pub use training_config::{Loss, Optimizer, TrainingConfig};
