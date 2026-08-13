# Runs clean_old_uploads.sh once a day. ponytail: a sleep loop, not a real
# crond entry. One daily job needs no scheduler. Change to crond for a real
# schedule, for example a specific time or several jobs.
FROM alpine:3
RUN apk add --no-cache findutils
COPY clean_old_uploads.sh /clean_old_uploads.sh
RUN chmod +x /clean_old_uploads.sh
ENTRYPOINT ["/bin/sh", "-c", "while true; do /clean_old_uploads.sh; sleep 1d; done"]
