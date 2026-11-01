use axum::{
    routing::{get, Router},
    Router,
};
use entities::capabilities::Capabilities;
use usecases::capabilities::GetCapabilities;

pub fn router(state::AppState) -> Router {
    Router::new().route("/capabilities", get(get_capabilities)).route("/trainings", post(start_training)).route("/trainings/{id}/stop", post(stop_training)).with_state(state)
}