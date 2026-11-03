mod capability;
mod data_spec;
mod layer;
mod model;
mod training_config;
mod training_mode;
mod training_process;
mod training_stop;

pub use capability::CapabilitiesDto;
pub use training_config::{StartTrainingRequestDto, StartTrainingResponseDto, TrainingConfigDto};
pub use training_process::TrainingProcessDto;
pub use training_stop::TrainingJobStatusDto;
