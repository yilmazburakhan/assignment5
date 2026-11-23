FROM denoland/deno:2.6.3
WORKDIR /app
COPY deno.json deno.lock* ./
COPY drizzle ./drizzle
COPY src ./src
RUN deno cache src/main.ts
RUN mkdir -p /data /app/uploads && chown -R deno:deno /data /app/uploads
USER deno
ENV DATABASE_URL=file:/data/tasks.db KV_PATH=/data/tasks.kv PORT=8000
EXPOSE 8000
CMD ["run", "--unstable-kv", "--unstable-cron", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "--allow-sys", "src/main.ts"]