#pragma once

#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ComputeDevice.hpp"

#include <memory>

class IModel;

// validatedModelGraph(検証済みのモデル構造)から IModel を組み立てるポート。
// 検証を通っていないグラフは、型の上で渡せない(実装側で再検証する必要がない)。
//
// 「どの具象レイヤ実装を使うか」(libtorch / 将来の別バックエンド)は
// infrastructure 層の実装が握る。checkpoint からの再構築や cold start は
// この口だけを知っていればよい。
class IModelFactory
{
public:
    virtual ~IModelFactory() = default;

    virtual std::shared_ptr<IModel> create(const validatedModelGraph &graph,const ComputeDevice &device) = 0;
};
