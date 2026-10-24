use futures_core::Stream;

use entities::model::ModelGraph;
use entities::training::config::TrainingConfig;
use entities::training::{JobId, TrainingProcess};
use thiserror::Error;

pub trait TrainingProcessProvider {
    type ProgressStream: Stream<Item = Result<TrainingProcess, TrainingProcessProviderError>> + Send; // c++から何度も届く通信(Stream) ItemはStreamが持つ関連型で通信で届く1件ごとの型をvariantなどで決めることができる今回のように。
    // Sendはその値を別スレッドに移しても安全であるということを示す。c++では原則スレッド内のものを移すことは禁止だったがこっちではOK
    // typeはエイリアスみたいなもの. このtraitを実装しているものでその型が定義される、
    fn stream_progress(
        &self,
        job_id: &JobId,
    ) -> impl Future<Output = Result<Self::ProgressStream, TrainingProcessProviderError>> + Send; // C++サーバーとのストリームを開くための関数(一回の通信だからFuture) OutputはFutureによる何らかのアクションで届く値こっちもvariantで動的に決めることができる。
}

/*
pub trait StartProcessOrder {
    fn start_training(
        training_config: &TrainingConfig,
        model_graph: &ModelGraph,
    ) -> impl Future<Output = Result<JobId, OrderError>> + Send; // C++サーバーに対して学習プロセスを開始するための命令を送る関数
}
*/

#[derive(Debug, Clone, PartialEq, Eq, Error)]

pub enum TrainingProcessProviderError {
    // 通信できなかった(C++のサーバーが起動していない. タイムアウトなど)
    #[error("training-process-provider is unavailable: {0}")]
    Unavailable(String),
    // 返ってきたデータが不正
    #[error("training-process-provider returned invalid data: {0}")]
    InvalidData(String),
}
