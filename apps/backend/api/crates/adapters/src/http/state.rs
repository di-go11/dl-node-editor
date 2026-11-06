use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    model::GetTrainingHistory,
    training::{
        GetTrainingProcess, RecordTrainingProgress, StartTraining, StopTraining,
        TrainingProgressProvider, TrainingRecordReader, TrainingStopper, ValidateTrainingConfig,
    },
};

use axum::extract::FromRef;
use std::sync::Arc;

// 型パラメータの境界(where句)について:
// AppState 側で必要なのは「ユースケース構造体の定義そのもの」に付いている境界だけ。
// 現在該当するのは GetCapabilities(C) / ValidateTrainingConfig(V) / GetTrainingProcess(P) / StopTraining(T) の4つ。
// StartTraining / RecordTrainingProgress / GetTrainingHistory は impl 側にだけ境界があるため、ここには書かない。
// TODO: 上記4つのユースケースも境界を impl 側へ移せば、このファイルの where 句はすべて削除できる。
// TODO(設計改善): 型パラメータの数そのものは、入力ポート導入(docs/issues/backend-db-remaining.md 作業12)で減らす。
pub struct AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    // Arcを使用して複数の変数で共有するためのスマートポインタにする
    pub get_capabilities: Arc<GetCapabilities<C>>,
    pub start_training: Arc<StartTraining<S, R, G, K>>,
    pub get_process: Arc<GetTrainingProcess<P>>,
    pub stop_training: Arc<StopTraining<T>>,
    pub validate_training: Arc<ValidateTrainingConfig<V>>,
    // TODO(設計改善): AppStateはHTTPハンドラが使うユースケースだけを持つべき。
    // 記録の起動をProgressRecordingSchedulerポート経由にしたら、このフィールドと型パラメータDを削除する。
    // 詳細は handler.rs の start_training のコメントを参照。
    pub record_training: Arc<RecordTrainingProgress<P, D>>,
    // 学習済みモデルの一覧・学習設定の取得(実装中)
    pub get_model_history: Arc<GetTrainingHistory<MSummary, MConfig>>,
}

// axum はリクエストごとに State を clone するため Clone が必要。
// #[derive(Clone)] だと全型パラメータに Clone 境界が付いてしまうので手書きしている
// (中身は Arc の参照カウントを +1 するだけで、ユースケース本体はコピーされない)。
impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig> Clone
    for AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
where
    C: CapabilityProvider,
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
            record_training: Arc::clone(&self.record_training),
            get_model_history: Arc::clone(&self.get_model_history),
        }
    }
}

// FromRef: ハンドラの State<Arc<ユースケース>> に、AppState から該当フィールドだけを取り出して渡すための実装。
impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>> for Arc<GetCapabilities<C>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>) -> Self {
        Arc::clone(&app_state.get_capabilities)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>>
    for Arc<StartTraining<S, R, G, K>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>) -> Self {
        Arc::clone(&app_state.start_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>>
    for Arc<GetTrainingProcess<P>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>) -> Self {
        Arc::clone(&app_state.get_process)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>> for Arc<StopTraining<T>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>) -> Self {
        Arc::clone(&app_state.stop_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>>
    for Arc<ValidateTrainingConfig<V>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>) -> Self {
        Arc::clone(&app_state.validate_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>>
    for Arc<RecordTrainingProgress<P, D>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>) -> Self {
        Arc::clone(&app_state.record_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>>
    for Arc<GetTrainingHistory<MSummary, MConfig>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig>) -> Self {
        Arc::clone(&app_state.get_model_history)
    }
}
