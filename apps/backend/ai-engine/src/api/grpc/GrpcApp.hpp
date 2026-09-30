#pragma once

// gRPC サーバーの合成層(composition root)。main.cpp から呼ばれる。
// CudaCapabilityProvider(infrastructure)と CapabilitiesServiceImpl(adapter)、
// TrainingJobManager(runTrainingJob を注入)と TrainingServiceImpl を、ここで初めて結びつける(DI)。
void runGrpcServer();
