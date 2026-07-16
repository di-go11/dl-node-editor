#ifndef SegnetConfig_HPP
#define SegnetConfig_HPP

#include <stdexcept>
#include <vector>

#include "../interface/IDetectionModelConfig.hpp"
#include "../interface/IActivationFunctionType.hpp"
#include "../interface/IModelType.hpp"

class SegnetConfig : public IDetectionModelConfig
{
private:
    std::string _modelType;
    std::string _networkType;
    IActivationFunctionType *_activationFunctionType;
    std::vector<unsigned int> _channels;
    unsigned int _height;
    unsigned int _width;
    unsigned int _imgLayer;
    unsigned int _kernelSize;

public:
    SegnetConfig(IActivationFunctionType *activationFunctionType, std::vector<unsigned int> channels, unsigned int height, unsigned int width, unsigned int imgLayer, unsigned int kernelSize);
    ~SegnetConfig() override;

    std::string getModelType() const override;
    std::string getNetworkType() const override;
    std::string getActivationFunctionType() const;
    std::vector<unsigned int> getChannels() const;
    unsigned int getHeight() const;
    unsigned int getWidth() const;
    unsigned int getImgLayer() const;
    unsigned int getKernelSize() const;
};
#endif // SegnetConfig_HPP