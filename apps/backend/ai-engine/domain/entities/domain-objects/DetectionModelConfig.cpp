#include "./DetectionModelConfig.hpp"

DetectionModelConfig::DetectionModelConfig(IModelType *modelType, IActivationFunctionType *activationFunctionType, unsigned int channels, unsigned int height, unsigned int width, unsigned int imgLayer)
    : _modelType(modelType), _activationFunctionType(activationFunctionType), _channels(channels), _height(height), _width(width), _imgLayer(imgLayer) {}

std::string DetectionModelConfig::getModelType() const
{
    return _modelType->getModelType();
}

std::string DetectionModelConfig::getActivationFunctionType() const
{
    return _activationFunctionType->getType();
}

unsigned int DetectionModelConfig::getChannels() const
{
    return _channels;
}

unsigned int DetectionModelConfig::getHeight() const
{
    return _height;
}

unsigned int DetectionModelConfig::getWidth() const
{
    return _width;
}

unsigned int DetectionModelConfig::getImgLayer() const
{
    return _imgLayer;
}
