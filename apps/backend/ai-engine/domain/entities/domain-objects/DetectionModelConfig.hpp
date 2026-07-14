#ifndef DETECTION_MODEL_CONFIG_HPP
#define DETECTION_MODEL_CONFIG_HPP

#include "../interface/IModelConfig.hpp"
#include "../interface/IActivationFunctionType.hpp"
#include "../interface/IModelType.hpp"

class DetectionModelConfig : public IModelConfig
{
private:
    IModelType *_modelType;
    IActivationFunctionType *_activationFunctionType;
    unsigned int _channels;
    unsigned int _height;
    unsigned int _width;
    unsigned int _imgLayer;

public:
    DetectionModelConfig(IModelType *modelType, IActivationFunctionType *activationFunctionType, unsigned int channels, unsigned int height, unsigned int width, unsigned int imgLayer);
    ~DetectionModelConfig() override;

    std::string getModelType() const override;
    std::string getActivationFunctionType() const;
    unsigned int getChannels() const;
    unsigned int getHeight() const;
    unsigned int getWidth() const;
    unsigned int getImgLayer() const;
};
#endif // DETECTION_MODEL_CONFIG_HPP