#pragma once

#include <torch/torch.h>

#include <cstddef>
#include <vector>

namespace training::infrastructure::torchFunc
{
    // checkpoint から optimizer の「状態」だけを復元し、ハイパーパラメータ(options)は
    // 構築時の値(= 今回の学習で指定された値)のまま残す。
    //
    // libtorch の Optimizer::load は、状態(Adam の exp_avg / exp_avg_sq / step、
    // SGD の momentum_buffer など)に加えて、各 param_group の options(lr / betas /
    // weight_decay など)も checkpoint の値で上書きする(torch/optim/serialize.h)。
    // そのままだと、学習再開時に lr などを変えても効かないため、load の前に
    // options を退避し、load の後に戻す。
    //
    // Options は torch::optim::{Adam,AdamW,SGD}Options。optim の実体の型と一致させること。
    template <class Options>
    void loadStateKeepingOptions(torch::optim::Optimizer &optim, torch::serialize::InputArchive &archive)
    {
        std::vector<Options> requested;
        requested.reserve(optim.param_groups().size());
        for (auto &group : optim.param_groups())
        {
            requested.push_back(static_cast<Options &>(group.options()));
        }

        // param_group の数が checkpoint と違えば、load 自体が例外を投げる。
        optim.load(archive);

        auto &groups = optim.param_groups();
        for (std::size_t i = 0; i < groups.size(); ++i)
        {
            static_cast<Options &>(groups[i].options()) = requested[i];
        }
    }
}
