#pragma once

// .config の model_architecture で選ぶ、学習に使うモデル構造の種類。
// 実際のグラフ組み立ては TrainingApp.cpp の buildXxxGraph() が担う。
enum class ModelArchitectureType
{
    Sample, // Conv 1層のみ。疎通確認用
    SegNet,
};
