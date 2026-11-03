use futures_core::Stream;

use entities::training::config::TrainingConfig;
use entities::training::{JobId, ModelId, TrainingJobStatus, TrainingProcess};

use super::error::{StartTrainingError, StopTrainingError, TrainingProcessProviderError};

pub trait TrainingProcessProvider {
    type ProgressStream: Stream<Item = Result<TrainingProcess, TrainingProcessProviderError>> + Send; // c++から何度も届く通信(Stream) ItemはStreamが持つ関連型で通信で届く1件ごとの型をvariantなどで決めることができる今回のように。
    // Sendはその値を別スレッドに移しても安全であるということを示す。c++では原則スレッド内のものを移すことは禁止だったがこっちではOK
    // typeはエイリアスみたいなもの. このtraitを実装しているものでその型が定義される、
    fn stream_progress(
        &self,
        job_id: &JobId,
    ) -> impl Future<Output = Result<Self::ProgressStream, TrainingProcessProviderError>> + Send; // C++サーバーとのストリームを開くための関数(一回の通信だからFuture) OutputはFutureによる何らかのアクションで届く値こっちもvariantで動的に決めることができる。
}

pub trait TrainingStarter {
    // model_graph は TrainingConfig のフィールドとして渡す
    fn start_training(
        &self,
        training_config: &TrainingConfig,
    ) -> impl Future<Output = Result<JobId, StartTrainingError>> + Send; // C++サーバーに対して学習プロセスを開始するための命令を送る関数
}

pub trait TrainingStopper {
    fn stop_training(
        &self,
        job_id: &JobId,
    ) -> impl Future<Output = Result<TrainingJobStatus, StopTrainingError>> + Send; // C++サーバーに対して学習プロセスを停止するための命令を送る関数戻り値として、学習ステータスを返す。
}
