// IImageDecoratorのdecorator実装。 特にmaskImageの読み込みに関して処理時間を計測することが主な役割となっている。
#pragma once

// 実装元インターフェース
#include "training/application/interfaces/image/IImageDecoder.hpp"

// 計測用インターフェース
#include "training/application/interfaces/ITimeRecorder.hpp"

struct ImageData;

#include <memory>

class TimedImageDecoder : public IImageDecoder
{
public:
    TimedImageDecoder(std::shared_ptr<IImageDecoder> decoder,
                      std::shared_ptr<ITimeRecorder> timeRecorder,
                      const std::string &name);
    ImageData decode(const std::string &imagePath) override;

private:
    std::shared_ptr<IImageDecoder> _decoder;
    std::shared_ptr<ITimeRecorder> _timeRecorder;
    std::string _name;
};