#include "TorchUpsampleLayer.hpp"
#include "DeviceToTorch.hpp"

namespace
{
    torch::nn::Upsample makeModule(const UpsampleSpec &specs)
    {
        const double scale = static_cast<double>(specs.scaleFactor);
        torch::nn::UpsampleOptions options;
        options.scale_factor(std::vector<double>{scale, scale}); // 高さ、幅の順

        switch (specs.upsampleMode)
        {
        case UpsampleMode::Bilinear:
            options.mode(torch::kBilinear);
            break;

        case UpsampleMode::Nearest:
            options.mode(torch::kNearest);
            break;
        default:
                }
    }
}