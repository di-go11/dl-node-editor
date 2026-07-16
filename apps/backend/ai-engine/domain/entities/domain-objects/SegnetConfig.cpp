#include "./SegnetConfig.hpp"


SegnetConfig::SegnetConfig(IActivationFunctionType *activationFunctionType, std::vector<unsigned int> channels, unsigned int height, unsigned int width, unsigned int imgLayer, unsigned int kernelSize)
    : _modelType("Object Detection"), _networkType("Segnet"), _activationFunctionType(activationFunctionType), _channels(channels), _height(height), _width(width), _imgLayer(imgLayer), _kernelSize(kernelSize) {}

std::string SegnetConfig::getModelType() const
{
    return _modelType;
}

std::string SegnetConfig::getNetworkType() const
{
    return _networkType;
}

std::string SegnetConfig::getActivationFunctionType() const
{
    return _activationFunctionType->getType();
}

unsigned int SegnetConfig::getKernelSize() const
{
    if (_kernelSize <= 0 || _kernelSize % 2 == 0) {
        throw std::invalid_argument("Kernel size must be a positive odd number");
    }
    return _kernelSize;
}

std::vector<unsigned int> SegnetConfig::getChannels() const
{
    if(_channels.empty()) {
        throw std::invalid_argument("Channels vector must not be empty");
    }
    for (unsigned int ch : _channels) {
        // Use bits to check if the number is a power of two and positive
        if ((ch & (ch - 1)) != 0) {
            throw std::invalid_argument("All channel values must be positive");
        }
    }
    return _channels;
}

unsigned int SegnetConfig::getHeight() const
{
    return _height;
}

unsigned int SegnetConfig::getWidth() const
{
    return _width;
}

unsigned int SegnetConfig::getImgLayer() const
{
    return _imgLayer;
}
