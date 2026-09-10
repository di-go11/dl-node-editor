#pragma once

#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/ComputeDevice.hpp"

#include <memory>

class IModel;

// ModelGraph(モデル構造の内部表現)から IModel を組み立てるポート。
//
// 「どの具象レイヤ実装を使うか」(libtorch / 将来の別バックエンド)は
// infrastructure 層の実装が握る。checkpoint からの再構築や cold start は
// この口だけを知っていればよい。
class IModelFactory
{
public:
    virtual ~IModelFactory() = default;

    virtual std::shared_ptr<IModel> create(const ModelGraph &graph, const ComputeDevice &device) = 0;
};
