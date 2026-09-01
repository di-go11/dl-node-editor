#include "training/infrastructure/torchModel/TorchModelStore.hpp"
#include "training/adapters/interfaces/IModel.hpp"
#include "training/infrastructure/torchModel/TorchModel.hpp"

#include <torch/torch.h>

#include <filesystem>
#include <stdexcept>

void TorchModelStore::save(const IModel &model, const std::string &path)
{
    const auto &torchModel = dynamic_cast<const TorchModel &>(model);

    const std::filesystem::path parent = std::filesystem::path(path).parent_path();
    if (!parent.empty())
    {
        std::filesystem::create_directories(parent);
    }

    torch::save(torchModel.parameters(), path);
}

void TorchModelStore::load(IModel &model, const std::string &path)
{
    auto &torchModel = dynamic_cast<TorchModel &>(model);

    std::vector<at::Tensor> loaded;
    torch::load(loaded, path);

    // parameters() が返すテンソルはモデル内部と記憶域を共有しているため、
    // copy_ で値を書き戻すとモデルの重みが更新される。
    std::vector<at::Tensor> current = torchModel.parameters();
    if (loaded.size() != current.size())
    {
        throw std::runtime_error(
            "TorchModelStore::load: parameter count mismatch (file=" +
            std::to_string(loaded.size()) + ", model=" + std::to_string(current.size()) + ")");
    }

    torch::NoGradGuard noGrad;
    for (std::size_t i = 0; i < current.size(); ++i)
    {
        current[i].copy_(loaded[i]);
    }
}
