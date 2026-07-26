# syntax=docker/dockerfile:1.7

ARG CLAMAV_IMAGE=clamav/clamav:1.4.5-debian13-slim@sha256:0542880c8abebb7430be5366657aec561f03693ed7be4e64a45fd2ee60b08d02
FROM ${CLAMAV_IMAGE}

COPY --chown=1000:1000 clamd.conf /etc/clamav/clamd.conf
