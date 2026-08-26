#pragma once

#include <memory>

#include "../interfaces/IModelConfig.hpp"



class InferenceParameter {
private:
    std::shared_ptr<IModelConfig> _modelConfig;
    float _confThreshold;

public:
    InferenceParameter(std::shared_ptr<IModelConfig> modelconfig, float confThreshold);
    ~InferenceParameter() = default;

    std::shared_ptr<IModelConfig> getModelConfig() const;
    float getConfThreshold() const;
};