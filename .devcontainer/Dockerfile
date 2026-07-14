FROM  mcr.microsoft.com/devcontainers/cpp:1-ubuntu-22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y libgmock-dev libgtest-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
