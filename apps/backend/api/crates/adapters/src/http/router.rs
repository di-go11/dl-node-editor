use super::handler::{get_capabilities, start_training, stop_training};

use super::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};
use usecases::{
    capabilities::CapabilityProvider,
    training::{TrainingProcessProvider, TrainingStarter, TrainingStopper},
};

pub fn router<C, S, P, T>(state: AppState<C, S, P, T>) -> Router
where
    C: CapabilityProvider + Send + Sync + 'static,
    S: TrainingStarter + Send + Sync + 'static,
    P: TrainingProcessProvider + Send + Sync + 'static,
    T: TrainingStopper + Send + Sync + 'static,
{
    Router::new()
        .route("/capabilities", get(get_capabilities::<C>))
        .route("/trainings", post(start_training::<S>))
        .route("/trainings/{job_id}/stop", post(stop_training::<T>))
        .with_state(state)
}
