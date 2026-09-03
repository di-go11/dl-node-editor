#pragma once

// ベストモデル更新時にチェックポイント(モデル重み + optimizer 状態 + epoch)を
// 永続化するためのポート。application 層はこの口だけを知り、
// 「何を・どこに・どの形式で」保存するかは infrastructure 実装に委ねる。
class ICheckpointStore
{
public:
    virtual ~ICheckpointStore() = default;
    virtual void saveBest(unsigned int epoch) = 0;
};
