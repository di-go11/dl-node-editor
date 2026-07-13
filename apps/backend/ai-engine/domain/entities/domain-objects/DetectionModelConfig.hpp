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

    IModelType *getModelType() const override;
    IActivationFunctionType *getActivationFunctionType() const;
    unsigned int getChannels() const;
    unsigned int getHeight() const;
    unsigned int getWidth() const;
    unsigned int getImgLayer() const;
};