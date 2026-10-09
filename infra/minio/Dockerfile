# Local development only: the pinned legacy server has known vulnerabilities.
FROM alpine:3.22.2@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412 AS verified
RUN apk add --no-cache ca-certificates=20260909-r0 curl=8.14.1-r3 minisign=0.12-r0
ARG TARGETARCH
WORKDIR /verified
# Key published in MinIO's Dockerfile.release at the signed release commit.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) expected=53e2a2cb16c5366ea6fbbc479c19ddb4c6a0948273e752f740fb1fbf27bb817c ;; \
      arm64) expected=6c2f3142c94240206123177f4ba1e360daa5d1e0a4962e90757ef4f92c3ab57c ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/minio/minio/releases/download/RELEASE.2025-04-22T22-12-26Z/minio.linux-${TARGETARCH}.RELEASE.2025-04-22T22-12-26Z"; \
    curl --fail --show-error --location --retry 3 --proto '=https' "$base" -o minio; \
    curl --fail --show-error --location --retry 3 --proto '=https' "$base.sha256sum" -o published.sha256sum; \
    curl --fail --show-error --location --retry 3 --proto '=https' "$base.minisig" -o minio.minisig; \
    read -r published ignored < published.sha256sum; \
    test "$published" = "$expected"; \
    printf '%s  minio\n' "$expected" > SHA256SUMS; \
    sha256sum -c SHA256SUMS; \
    minisign -Vm minio -x minio.minisig -P RWTx5Zr1tiHQLwG9keckT0c45M3AGeHD6IvimQHpyRywVWGbP1aVSGav; \
    printf 'SHA256 and official Minisign verification passed\n' > verification.txt; \
    curl --fail --show-error --location --retry 3 --proto '=https' \
      https://raw.githubusercontent.com/minio/minio/0d7408fc9969caf07de6a8c3a84f9fbb10a6739e/LICENSE -o LICENSE; \
    chmod 0555 minio

FROM alpine:3.22.2@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412
RUN apk add --no-cache ca-certificates=20260909-r0 curl=8.14.1-r3 \
    && addgroup -g 10001 minio \
    && adduser -D -u 10001 -G minio minio \
    && mkdir /data \
    && chown 10001:10001 /data
COPY --from=verified /verified/minio /usr/local/bin/minio
COPY --from=verified /verified/LICENSE /verified/SHA256SUMS /verified/published.sha256sum /verified/minio.minisig /verified/verification.txt /usr/share/minio/
LABEL org.opencontainers.image.version="RELEASE.2025-04-22T22-12-26Z" \
      org.opencontainers.image.description="Locally packaged official MinIO binary; development only, not production-safe" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
