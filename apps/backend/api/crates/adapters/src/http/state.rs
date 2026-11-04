use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    training::{
        GetTrainingProcess, ModelIdGenerator, StartTraining, StopTraining, TrainingProgressProvider,
        TrainingRecordReader, TrainingRunRegistar, TrainingStarter, TrainingStopper,
        ValidateTrainingConfig,
    },
};

use axum::extract::FromRef;
use std::sync::Arc;

pub struct AppState<C, S, R, G, V, P, T>
// pub struct AppState<C: CapabilityProvider, S: TrainingStarter, P: TrainingProgressProvider, T: TrainingStopper>と同じ
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    // Arcを使用すして複数の変数で共有するためのスマートポインタにする
    pub get_capabilities: Arc<GetCapabilities<C>>,
    pub start_training: Arc<StartTraining<S, R, G>>,
    pub get_process: Arc<GetTrainingProcess<P>>,
    pub stop_training: Arc<StopTraining<T>>,
    pub validate_training: Arc<ValidateTrainingConfig<V>>,
}

impl<C, S, R, G, V, P, T> Clone for AppState<C, S, R, G, V, P, T>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn clone(&self) -> Self {
        Self {
            get_capabilities: Arc::clone(&self.get_capabilities),
            start_training: Arc::clone(&self.start_training),
            get_process: Arc::clone(&self.get_process),
            stop_training: Arc::clone(&self.stop_training),
            validate_training: Arc::clone(&self.validate_training),
        }
    }
}

impl<C, S, R, G, V, P, T> FromRef<AppState<C, S, R, G, V, P, T>> for Arc<GetCapabilities<C>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, V, P, T>) -> Self {
        Arc::clone(&app_state.get_capabilities)
    }
}

impl<C, S, R, G, V, P, T> FromRef<AppState<C, S, R, G, V, P, T>> for Arc<StartTraining<S, R, G>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, V, P, T>) -> Self {
        Arc::clone(&app_state.start_training)
    }
}

impl<C, S, R, G, V, P, T> FromRef<AppState<C, S, R, G, V, P, T>> for Arc<GetTrainingProcess<P>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, V, P, T>) -> Self {
        Arc::clone(&app_state.get_process)
    }
}

impl<C, S, R, G, V, P, T> FromRef<AppState<C, S, R, G, V, P, T>> for Arc<StopTraining<T>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, V, P, T>) -> Self {
        Arc::clone(&app_state.stop_training)
    }
}

impl<C, S, R, G, V, P, T> FromRef<AppState<C, S, R, G, V, P, T>> for Arc<ValidateTrainingConfig<V>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, V, P, T>) -> Self {
        Arc::clone(&app_state.validate_training)
    }
}
