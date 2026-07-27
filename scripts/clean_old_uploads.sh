#!/bin/sh
set -eu

PATH_TO_UPLOADS="/uploads"
UPLOAD_RETENTION_DAYS="${UPLOAD_RETENTION_DAYS:-30}"

count=$(find "$PATH_TO_UPLOADS" -type f -ctime "+$UPLOAD_RETENTION_DAYS" -delete -print | wc -l)
echo "$(date -Iseconds) cleanup: deleted $count file(s) older than $UPLOAD_RETENTION_DAYS day(s) from $PATH_TO_UPLOADS"
