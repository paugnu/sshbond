FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless openssh-server unzip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd \
    && passwd -d root

ARG KOTLIN_VERSION=2.1.20
RUN curl -fSL --retry 3 \
    "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" \
    -o /tmp/kotlin.zip \
    && unzip -q /tmp/kotlin.zip -d /opt \
    && rm /tmp/kotlin.zip
ENV PATH="/opt/kotlinc/bin:${PATH}"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# sshd listens only on loopback inside the container; no ports are published.
CMD ["bash", "modules/expo-sshbond/integration/run.sh"]
