use super::handler::{
    get_capabilities, get_training_process, get_training_status, start_training, stop_training,
    stream_training_process,
};

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
        .route("/trainings/{job_id}", get(get_training_process::<P>))
        .route(
            "/trainings/{job_id}/progress",
            get(stream_training_process::<P>),
        )
        .route("/trainings/{job_id}/stop", post(stop_training::<T>))
        .route("/trainings/{job_id}/status", get(get_training_status::<P>))
        .with_state(state)
}
