# Daily backup of cachifa_db: pg_dump + gzip + rclone (`crypt` remote).
#
# Same base image as the `postgres` service, so pg_dump always matches the server's
# major version (16). If the `postgres` service is ever upgraded, bump this FROM too.
FROM postgres:16-alpine

# rclone comes from Alpine's repositories; tzdata is already in the base image
# (needed to schedule in America/Bogota).
RUN apk add --no-cache rclone

COPY backup.sh /usr/local/bin/cachifa-backup
RUN chmod 0755 /usr/local/bin/cachifa-backup

# Local dumps (the newest BACKUP_LOCAL_KEEP) and the status of the last attempt.
VOLUME ["/backups", "/status"]

ENV TZ=America/Bogota \
    RCLONE_CONFIG=/config/rclone/rclone.conf

# Not Postgres' entrypoint: this container never starts a server.
ENTRYPOINT ["/usr/local/bin/cachifa-backup"]
CMD ["schedule"]
