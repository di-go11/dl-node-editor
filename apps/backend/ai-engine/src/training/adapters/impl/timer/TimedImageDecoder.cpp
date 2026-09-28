#include "TimedImageDecoder.hpp"

#include "training/entities/image/ImageData.hpp"
#include "training/application/impl/ScopedTimer.hpp"

#include <string>
#include <filesystem>

TimedImageDecoder::TimedImageDecoder(std::shared_ptr<IImageDecoder> decoder,
                                     std::shared_ptr<ITimeRecorder> timeRecorder,
                                     const std::string &name)
    : _decoder(std::move(decoder)), _timeRecorder(std::move(timeRecorder)), _name(name)
{
}

ImageData TimedImageDecoder::decode(const std::string &imagePath)
{
    const std::string extension = std::filesystem::path(imagePath).extension().string(); // ".jpeg",".png"
    ScopedTimer timer(*_timeRecorder, _name + extension);                                // 画像の拡張子ごとに計測することで、jpeg/pngの読み込み時間の違いを計測できるようにする。
    return _decoder->decode(imagePath);
}