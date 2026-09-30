#pragma once

// CLI 用の合成層(composition root)。main.cpp から呼ばれる。
// .config を読み、モデル構造を組み立てて runTrainingJob(TrainingJob.hpp)に渡す。
void runTraining();
