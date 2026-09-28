#pragma once

#include "training/adapters/interfaces/ILoss.hpp"

#include <cstdint>

class CrossEntropy : public ILoss
{
public:
    // ignoreIndex: このラベル値のピクセルは損失に寄与しない(Letterbox 余白など)。
    explicit CrossEntropy(int64_t ignoreIndex = 255);

    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;

private:
    int64_t _ignoreIndex;
};
