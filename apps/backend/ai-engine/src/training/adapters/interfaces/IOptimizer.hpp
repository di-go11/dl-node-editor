#pragma once

#include <string>

class IOptimizer
{
public:
    virtual ~IOptimizer() = default;
    virtual void resetGradients() = 0;                       // 勾配リセット
    virtual void updateParmeters() = 0;                      // パラメータ更新
    virtual void saveState(const std::string &filePath) = 0; // Optimizer の状態を保存
    virtual void loadState(const std::string &filePath) = 0; // Optimizer の状態を読み込み
};