#pragma once

class ICheckpointWriter;
class ICheckpointReader;

class IOptimizer
{
public:
    virtual ~IOptimizer() = default;
    virtual void resetGradients() = 0;  // 勾配リセット
    virtual void updateParmeters() = 0; // パラメータ更新

    // Optimizer の内部状態(exp_avg / exp_avg_sq / step / momentum_buffer 等)を
    // archive へ書き出す / archive から復元する。
    // archive の実体・フォーマットは infrastructure 層(libtorch)が握る。
    virtual void writeTo(ICheckpointWriter &archive) const = 0;
    virtual void readFrom(ICheckpointReader &archive) = 0;
};
