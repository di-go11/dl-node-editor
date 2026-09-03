#pragma once

// 学習チェックポイントのシリアライズ先 / 元を表す不透明ハンドル。
//
// 実体(libtorch の torch::serialize::OutputArchive / InputArchive)は
// infrastructure 層が生成・保持する。adapters / application 層はこの型を
// 「下位へ通すだけ」で、中身のフォーマットには一切触れない。
// これにより IModel / IOptimizer のシグネチャから libtorch 依存を排除する。

class ICheckpointWriter
{
public:
    virtual ~ICheckpointWriter() = default;
};

class ICheckpointReader
{
public:
    virtual ~ICheckpointReader() = default;
};
