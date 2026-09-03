#pragma once

#include "training/adapters/interfaces/ICheckpointArchive.hpp"

#include <torch/serialize.h>

#include <stdexcept>

// ICheckpointWriter / ICheckpointReader の libtorch 実装。
//
// infrastructure 層の各実装(TorchModel / *Optimizer / TorchCheckpointStore)だけが
// この具象型を知り、torch::serialize::*Archive にアクセスする。
// adapters / application 層は不透明ハンドルとしてしか扱わない。

class TorchCheckpointWriter : public ICheckpointWriter
{
public:
    explicit TorchCheckpointWriter(torch::serialize::OutputArchive &archive)
        : _archive(archive) {}

    torch::serialize::OutputArchive &archive() const { return _archive; }

private:
    torch::serialize::OutputArchive &_archive;
};

class TorchCheckpointReader : public ICheckpointReader
{
public:
    explicit TorchCheckpointReader(torch::serialize::InputArchive &archive)
        : _archive(archive) {}

    torch::serialize::InputArchive &archive() const { return _archive; }

private:
    torch::serialize::InputArchive &_archive;
};

// 不透明ハンドルから libtorch の archive を取り出すヘルパ。
// infrastructure 層は必ず Torch* 実装を渡すため、型が合わなければプログラミングエラー。
inline torch::serialize::OutputArchive &toTorchArchive(ICheckpointWriter &writer)
{
    auto *torchWriter = dynamic_cast<TorchCheckpointWriter *>(&writer);
    if (torchWriter == nullptr)
    {
        throw std::runtime_error("toTorchArchive: ICheckpointWriter is not a TorchCheckpointWriter");
    }
    return torchWriter->archive();
}

inline torch::serialize::InputArchive &toTorchArchive(ICheckpointReader &reader)
{
    auto *torchReader = dynamic_cast<TorchCheckpointReader *>(&reader);
    if (torchReader == nullptr)
    {
        throw std::runtime_error("toTorchArchive: ICheckpointReader is not a TorchCheckpointReader");
    }
    return torchReader->archive();
}
