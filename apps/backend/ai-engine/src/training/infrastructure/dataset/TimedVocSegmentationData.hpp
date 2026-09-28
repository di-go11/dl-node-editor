// ISegmentationDataのDecorator。getImage/getMaskの処理時間を計測する。

#pragma once

#include "training/application/interfaces/ITimeRecorder.hpp"
#include "training/infrastructure/dataset/interfaces/ISegmentationData.hpp"
#include "training/entities/image/ImageData.hpp"

#include <memory>
#include <string>

class TimedVocSegmentationData : public ISegmentationData
{
public:
    TimedVocSegmentationData(std::shared_ptr<ISegmentationData> source,
                             std::shared_ptr<ITimeRecorder> timeRecorder,
                             const std::string &name);
    size_t size() const override;
    ImageData getImage(size_t index) const override;
    ImageData getMask(size_t index) const override;

private:
    std::shared_ptr<ISegmentationData> _source;
    std::shared_ptr<ITimeRecorder> _timeRecorder;
    std::string _imageName;
    std::string _maskName;
};