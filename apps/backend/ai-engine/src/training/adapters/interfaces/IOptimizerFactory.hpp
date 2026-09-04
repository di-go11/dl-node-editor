#pragma once

#include "training/entities/domain-objects/OptimizerConfig.hpp"

#include <memory>
#include <vector>

namespace at
{
    class Tensor;
}

class IOptimizer;

// OptimizerConfig と「更新対象パラメータ」から IOptimizer を組み立てるポート。
//
// Optimizer は構築時に対象パラメータを受け取る必要があるため、モデルを先に
// 組み立ててから その parameters() を渡す、という順序依存がある。
// checkpoint からの再構築(CheckpointModelLoader)はこの順序をこのポート越しに扱う。
class IOptimizerFactory
{
public:
    virtual ~IOptimizerFactory() = default;

    // parameters は IModel::parameters() の戻り値。モデル内部と記憶域を共有する
    // ハンドルなので、呼び出し側は生成した Optimizer より長く保持すること。
    virtual std::shared_ptr<IOptimizer> create(std::vector<at::Tensor> &parameters,
                                               const OptimizerConfig &config) = 0;
};
