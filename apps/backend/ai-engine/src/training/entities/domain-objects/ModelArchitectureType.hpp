#pragma once

// .config の model_architecture で選ぶ、学習に使うモデル構造の種類。
// 実際のグラフ組み立ては TrainingApp.cpp の buildXxxGraph() が担う。
enum class ModelArchitectureType
{
    Sample, // Conv 1層のみ。疎通確認用
    SegNet,
    SegNetDilated,     // SegNet の encoder 4・5 段目の pooling を dilated conv に置き換えたもの(解像度は 1/8 まで)
    SegNetFullDilated, // SegNet の pooling をすべてやめ、dilated conv だけで受容野を広げたもの(解像度を落とさない)
};
