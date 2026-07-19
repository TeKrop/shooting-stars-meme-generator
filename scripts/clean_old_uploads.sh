#!/bin/sh
set -eu

PATH_TO_UPLOADS="/uploads"
UPLOAD_RETENTION_DAYS="${UPLOAD_RETENTION_DAYS:-30}"

# If every upload ages out at once, find will also try to -delete the
# /uploads mount point itself; that fails harmlessly ("Device or resource
# busy", since it's an active bind mount) and just makes this run's exit
# code non-zero, which the entrypoint's loop ignores.
find "$PATH_TO_UPLOADS" -ctime "+$UPLOAD_RETENTION_DAYS" -delete
