#pragma once

// 学習パイプラインの合成層(composition root)。main.cpp から呼ばれる。
// .config を読み、cold start / resume を判定し、学習ループを最後まで回す。
void runTraining();
