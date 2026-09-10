#pragma once

#include <torch/torch.h>

namespace training::infrastructure::torchFunc
{
    // optimizer->load() 直後、optimizer state のテンソル(Adam の exp_avg /
    // exp_avg_sq、SGD の momentum_buffer など)は checkpoint 保存時の device 上に
    // ある。param が別 device(CPU 保存 → GPU 再開、GPU 保存 → CPU 再開)だと
    // 次の step() で "tensors on different devices" になるため、各 param state の
    // テンソルを対応する param の device へ揃える。
    //
    // ParamState は torch::optim::{Adam,AdamW,SGD}ParamState。
    // move は (ParamState&, const torch::Device&) を受け取り、内部テンソルを
    // その device へ移す処理。
    template <class ParamState, class MoveFn>
    void syncOptimizerStateToParamDevice(torch::optim::Optimizer &optim, MoveFn &&move)
    {
        for (auto &group : optim.param_groups())
        {
            for (auto &param : group.params())
            {
                const auto it = optim.state().find(param.unsafeGetTensorImpl());
                if (it == optim.state().end())
                {
                    continue; // 最初の step() 前は state が未生成
                }
                move(static_cast<ParamState &>(*it->second), param.device());
            }
        }
    }
}
