mod data_spec;
mod training_config;

pub use data_spec::{
    DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, PascalVocConfig, RgbColor,
    SegmentationSpec,
};

pub use training_config::{Loss, Optimizer, TrainingConfig};
