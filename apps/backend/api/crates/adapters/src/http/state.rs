use usecases::{
    capabilities::{CapabilityProvider, GetCapabilities},
    dataset::{read_datasets_summary::ReadDatasetsSummary, upload_dataset::UploadDataset},
    model::{GetModelSummary, GetModelTrainingConfig},
    training::{
        GetTrainingProcess, RecordTrainingProgress, ResumeTraining, StartTraining, StopTraining,
        TrainingProgressProvider, TrainingRecordReader, TrainingStopper, ValidateTrainingConfig,
    },
};

use axum::extract::FromRef;
use std::sync::Arc;

// 型パラメータの境界(where句)について:
// AppState 側で必要なのは「ユースケース構造体の定義そのもの」に付いている境界だけ。
// 現在該当するのは GetCapabilities(C) / ValidateTrainingConfig(V) / GetTrainingProcess(P) / StopTraining(T) の4つ。
// StartTraining / RecordTrainingProgress / GetModelSummary / GetModelTrainingConfig / ResumeTraining / UploadDataset は
// impl 側にだけ境界があるため、ここには書かない。
// TODO: 上記4つのユースケースも境界を impl 側へ移せば、このファイルの where 句はすべて削除できる。
// TODO(設計改善): 型パラメータの数そのものは、入力ポート導入(docs/issues/backend-db-remaining.md 作業12)で減らす。
// TODO: ジェネリクスの名称を変える(DatasetReaderとDatasetRegisterでイニシャルが両方ともDRになってしまうため、DatasetReaderをDRDにしている)
pub struct AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    // Arcを使用して複数の変数で共有するためのスマートポインタにする
    pub get_capabilities: Arc<GetCapabilities<C>>,
    // データセットの ID からパスを引くのは DRD(DatasetReader と DatasetFinder の両方を実装した型)
    pub start_training: Arc<StartTraining<S, R, G, K, DRD>>,
    pub get_process: Arc<GetTrainingProcess<P>>,
    pub stop_training: Arc<StopTraining<T>>,
    // 整合性チェック。グラフの検証は S(GrpcTrainingStarter)、データセットの検索は DRD を学習開始と共有する
    pub validate_training: Arc<ValidateTrainingConfig<V, S, DRD>>,
    // TODO(設計改善): AppStateはHTTPハンドラが使うユースケースだけを持つべき。
    // 記録の起動をProgressRecordingSchedulerポート経由にしたら、このフィールドと型パラメータDを削除する。
    // 詳細は handler.rs の start_training のコメントを参照。
    pub record_training: Arc<RecordTrainingProgress<P, D>>,
    // 学習済みモデルの一覧・最新の学習設定の取得
    pub get_model_summary: Arc<GetModelSummary<MSummary>>,
    pub get_model_config: Arc<GetModelTrainingConfig<MConfig>>,
    // 学習再開。依存は既存の型パラメータを使い回す(resumer = S、registar = R、scheduler = K、設定の読み出し = MConfig)。
    // S は TrainingStarter と TrainingResumer の両方を実装した型(GrpcTrainingStarter)にする必要がある。
    // TODO(設計改善): 作業12 で入力ポートを導入したら、ResumeTraining 用の型パラメータ 1 つに分ける。
    pub resume_training: Arc<ResumeTraining<MConfig, S, R, K>>,
    // データセットアップロード用
    pub upload_dataset: Arc<UploadDataset<DG, DS, DR>>,
    // データセットのメタデータ一覧取得
    pub read_dataset_summary: Arc<ReadDatasetsSummary<DRD>>,
}

// axum はリクエストごとに State を clone するため Clone が必要。
// #[derive(Clone)] だと全型パラメータに Clone 境界が付いてしまうので手書きしている
// (中身は Arc の参照カウントを +1 するだけで、ユースケース本体はコピーされない)。
impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD> Clone
    for AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
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
            get_model_summary: Arc::clone(&self.get_model_summary),
            get_model_config: Arc::clone(&self.get_model_config),
            resume_training: Arc::clone(&self.resume_training),
            upload_dataset: Arc::clone(&self.upload_dataset),
            read_dataset_summary: Arc::clone(&self.read_dataset_summary),
        }
    }
}

// FromRef: ハンドラの State<Arc<ユースケース>> に、AppState から該当フィールドだけを取り出して渡すための実装。
impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<GetCapabilities<C>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.get_capabilities)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<StartTraining<S, R, G, K, DRD>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.start_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<GetTrainingProcess<P>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.get_process)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<StopTraining<T>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.stop_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<ValidateTrainingConfig<V, S, DRD>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.validate_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<RecordTrainingProgress<P, D>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.record_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<GetModelSummary<MSummary>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.get_model_summary)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<GetModelTrainingConfig<MConfig>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.get_model_config)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<ResumeTraining<MConfig, S, R, K>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.resume_training)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<UploadDataset<DG, DS, DR>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.upload_dataset)
    }
}

impl<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>
    FromRef<AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>>
    for Arc<ReadDatasetsSummary<DRD>>
where
    C: CapabilityProvider,
    V: TrainingRecordReader,
    P: TrainingProgressProvider,
    T: TrainingStopper,
{
    fn from_ref(
        app_state: &AppState<C, S, R, G, K, V, P, T, D, MSummary, MConfig, DG, DS, DR, DRD>,
    ) -> Self {
        Arc::clone(&app_state.read_dataset_summary)
    }
}
