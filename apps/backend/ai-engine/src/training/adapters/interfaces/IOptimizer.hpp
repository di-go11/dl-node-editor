#pragma once

class IOptimizer
{
public:
    virtual ~IOptimizer() = default;
    virtual void resetGradients() = 0;  // 勾配リセット
    virtual void updateParmeters() = 0; // パラメータ更新
};