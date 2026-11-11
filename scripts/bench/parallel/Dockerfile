# Throwaway: GitHub Actions runner + docker CLI/compose, talking to a dind sidecar.
FROM docker:27-cli AS cli
FROM ghcr.io/actions/actions-runner:latest
USER root
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /home/runner/_work && chown runner:runner /home/runner/_work
USER runner
ENTRYPOINT ["/entrypoint.sh"]
