use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    training::{
        GetTrainingProcess, StartTraining, StopTraining, TrainingProcessProvider, TrainingStarter,
        TrainingStopper,
    },
};

use axum::extract::FromRef;
use std::sync::Arc;

pub struct AppState<C, S, P, T>
// pub struct AppState<C: CapabilityProvider, S: TrainingStarter, P: TrainingProcessProvider, T: TrainingStopper>と同じ
where
    C: CapabilityProvider,
    S: TrainingStarter,
    P: TrainingProcessProvider,
    T: TrainingStopper,
{
    // Arcを使用すして複数の変数で共有するためのスマートポインタにする
    pub get_capabilities: Arc<GetCapabilities<C>>,
    pub start_training: Arc<StartTraining<S>>,
    pub get_process: Arc<GetTrainingProcess<P>>,
    pub stop_training: Arc<StopTraining<T>>,
}

impl<C, S, P, T> Clone for AppState<C, S, P, T>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    P: TrainingProcessProvider,
    T: TrainingStopper,
{
    fn clone(&self) -> Self {
        Self {
            get_capabilities: Arc::clone(&self.get_capabilities),
            start_training: Arc::clone(&self.start_training),
            get_process: Arc::clone(&self.get_process),
            stop_training: Arc::clone(&self.stop_training),
        }
    }
}

impl<C, S, P, T> FromRef<AppState<C, S, P, T>> for Arc<GetCapabilities<C>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    P: TrainingProcessProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, P, T>) -> Self {
        Arc::clone(&app_state.get_capabilities)
    }
}

impl<C, S, P, T> FromRef<AppState<C, S, P, T>> for Arc<StartTraining<S>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    P: TrainingProcessProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, P, T>) -> Self {
        Arc::clone(&app_state.start_training)
    }
}

impl<C, S, P, T> FromRef<AppState<C, S, P, T>> for Arc<GetTrainingProcess<P>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    P: TrainingProcessProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, P, T>) -> Self {
        Arc::clone(&app_state.get_process)
    }
}

impl<C, S, P, T> FromRef<AppState<C, S, P, T>> for Arc<StopTraining<T>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    P: TrainingProcessProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, P, T>) -> Self {
        Arc::clone(&app_state.stop_training)
    }
}
