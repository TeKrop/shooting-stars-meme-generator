# Runs clean_old_uploads.sh once a day. ponytail: a sleep loop instead of a
# real crond entry — one less moving part for a single daily job; swap for
# crond if this ever needs a real schedule (specific time, multiple jobs).
FROM alpine:3
RUN apk add --no-cache findutils
COPY clean_old_uploads.sh /clean_old_uploads.sh
RUN chmod +x /clean_old_uploads.sh
ENTRYPOINT ["/bin/sh", "-c", "while true; do /clean_old_uploads.sh; sleep 1d; done"]
