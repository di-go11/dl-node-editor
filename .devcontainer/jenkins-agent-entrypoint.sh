#!/bin/bash
set -euo pipefail

: "${JENKINS_URL:?JENKINS_URL is required}"
: "${JENKINS_AGENT_NAME:?JENKINS_AGENT_NAME is required}"
: "${JENKINS_SECRET:?JENKINS_SECRET is required}"

curl -fsSL -o /home/jenkins/agent/agent.jar "${JENKINS_URL%/}/jnlpJars/agent.jar"

exec java -jar /home/jenkins/agent/agent.jar \
    -url "${JENKINS_URL}" \
    -name "${JENKINS_AGENT_NAME}" \
    -secret "${JENKINS_SECRET}" \
    -workDir "/home/jenkins/agent"