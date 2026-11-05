use super::handler::{
    get_capabilities, get_training_process, get_training_status, start_training, stop_training,
    stream_training_process, validate_training,
};

use super::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};
use usecases::{
    capabilities::CapabilityProvider,
    training::{
        ModelIdGenerator, TrainingProgressProvider, TrainingProgressRecorder, TrainingRecordReader,
        TrainingRunRegistar, TrainingStarter, TrainingStopper,
    },
};

pub fn router<C, S, R, G, V, P, T, D>(state: AppState<C, S, R, G, V, P, T, D>) -> Router
where
    C: CapabilityProvider + Send + Sync + 'static,
    S: TrainingStarter + Send + Sync + 'static,
    R: TrainingRunRegistar + Send + Sync + 'static,
    G: ModelIdGenerator + Send + Sync + 'static,
    V: TrainingRecordReader + Send + Sync + 'static,
    P: TrainingProgressProvider + Send + Sync + 'static,
    T: TrainingStopper + Send + Sync + 'static,
    D: TrainingProgressRecorder
        + TrainingRecordReader
        + TrainingRunRegistar
        + Send
        + Sync
        + 'static,
{
    Router::new().nest(
        "/api/v1",
        Router::new()
            .route("/capabilities", get(get_capabilities::<C>))
            .route("/trainings", post(start_training::<S, R, G, P, D>))
            .route("/trainings/validate", post(validate_training::<V>))
            .route("/trainings/{job_id}", get(get_training_process::<P>))
            .route(
                "/trainings/{job_id}/progress",
                get(stream_training_process::<P>),
            )
            .route("/trainings/{job_id}/stop", post(stop_training::<T>))
            .route("/trainings/{job_id}/status", get(get_training_status::<P>))
            .with_state(state),
    )
}
