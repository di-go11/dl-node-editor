use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    training::{
        GetTrainingProcess, ModelIdGenerator, ProgressRecordingScheduler, RecordTrainingProgress,
        StartTraining, StopTraining,
        TrainingProgressProvider, TrainingProgressRecorder, TrainingRecordReader,
        TrainingRunRegistar, TrainingStarter, TrainingStopper, ValidateTrainingConfig,
    },
};

use axum::extract::FromRef;
use std::sync::Arc;

pub struct AppState<C, S, R, G, K, V, P, T, D>
// pub struct AppState<C: CapabilityProvider, S: TrainingStarter, P: TrainingProgressProvider, T: TrainingStopper>と同じ
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
    D: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
{
    // Arcを使用すして複数の変数で共有するためのスマートポインタにする
    pub get_capabilities: Arc<GetCapabilities<C>>,
    pub start_training: Arc<StartTraining<S, R, G, K>>,
    pub get_process: Arc<GetTrainingProcess<P>>,
    pub stop_training: Arc<StopTraining<T>>,
    pub validate_training: Arc<ValidateTrainingConfig<V>>,
    // TODO(設計改善): AppStateはHTTPハンドラが使うユースケースだけを持つべき。
    // 記録の起動をProgressRecordingSchedulerポート経由にしたら、このフィールドと型パラメータDを削除する。
    // 詳細は handler.rs の start_training のコメントを参照。
    pub record_training: Arc<RecordTrainingProgress<P, D>>,
}

impl<C, S, R, G, K, V, P, T, D> Clone for AppState<C, S, R, G, K, V, P, T, D>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
    D: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
{
    fn clone(&self) -> Self {
        Self {
            get_capabilities: Arc::clone(&self.get_capabilities),
            start_training: Arc::clone(&self.start_training),
            get_process: Arc::clone(&self.get_process),
            stop_training: Arc::clone(&self.stop_training),
            validate_training: Arc::clone(&self.validate_training),
            record_training: Arc::clone(&self.record_training),
        }
    }
}

impl<C, S, R, G, K, V, P, T, D> FromRef<AppState<C, S, R, G, K, V, P, T, D>> for Arc<GetCapabilities<C>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
    D: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D>) -> Self {
        Arc::clone(&app_state.get_capabilities)
    }
}

impl<C, S, R, G, K, V, P, T, D> FromRef<AppState<C, S, R, G, K, V, P, T, D>>
    for Arc<StartTraining<S, R, G, K>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
    D: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D>) -> Self {
        Arc::clone(&app_state.start_training)
    }
}

impl<C, S, R, G, K, V, P, T, D> FromRef<AppState<C, S, R, G, K, V, P, T, D>>
    for Arc<GetTrainingProcess<P>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
    D: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D>) -> Self {
        Arc::clone(&app_state.get_process)
    }
}

impl<C, S, R, G, K, V, P, T, D> FromRef<AppState<C, S, R, G, K, V, P, T, D>> for Arc<StopTraining<T>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
    D: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D>) -> Self {
        Arc::clone(&app_state.stop_training)
    }
}

impl<C, S, R, G, K, V, P, T, D> FromRef<AppState<C, S, R, G, K, V, P, T, D>>
    for Arc<ValidateTrainingConfig<V>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
    D: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D>) -> Self {
        Arc::clone(&app_state.validate_training)
    }
}

impl<C, S, R, G, K, V, P, T, D> FromRef<AppState<C, S, R, G, K, V, P, T, D>>
    for Arc<RecordTrainingProgress<P, D>>
where
    C: CapabilityProvider,
    S: TrainingStarter,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
    D: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D>) -> Self {
        Arc::clone(&app_state.record_training)
    }
}
