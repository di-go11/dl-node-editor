// ModelGraph(entities/model)に関するアダプター。
// 学習(training)に限らず、モデル一覧や学習再開でも使うため、training とは別のモジュールにする。
mod graph_json;

pub(crate) use graph_json::to_json;
pub(crate) use graph_json::from_json;
