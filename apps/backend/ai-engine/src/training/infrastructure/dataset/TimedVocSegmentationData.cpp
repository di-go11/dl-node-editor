#include "TimedVocSegmentationData.hpp"

#include "training/application/impl/ScopedTimer.hpp"
#include <utility>

TimedVocSegmentationData::TimedVocSegmentationData(std::shared_ptr<ISegmentationData> source,
                                                   std::shared_ptr<ITimeRecorder> timeRecorder,
                                                   const std::string &name) : _source(std::move(source)), _timeRecorder(std::move(timeRecorder)), _imageName(name + ".getImage"), _maskName(name + ".getMask")
{
}

size_t TimedVocSegmentationData::size() const
{
    return _source->size();
}

ImageData TimedVocSegmentationData::getImage(size_t index) const
{
    ScopedTimer timer(*_timeRecorder, _imageName);
    return _source->getImage(index);
}

ImageData TimedVocSegmentationData::getMask(size_t index) const
{
    ScopedTimer timer(*_timeRecorder, _maskName);
    return _source->getMask(index);
}