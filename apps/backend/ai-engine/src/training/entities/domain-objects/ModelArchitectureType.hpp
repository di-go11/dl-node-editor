#pragma once

// .config の model_architecture で選ぶ、学習に使うモデル構造の種類。
// 実際のグラフ組み立ては application/impl/ModelGraphPresets の各プリセットが担い、TrainingApp.cpp が種類に応じて選ぶ。
enum class ModelArchitectureType
{
    SegNet,
    Unet,
};
