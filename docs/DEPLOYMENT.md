# Deployment notes

What a production host must set up beyond `docker compose` and the env files. See also
`docs/SECURITY_HEADERS.md` ("Still to do at deployment").

## Live leaderboard (Server-Sent Events)

`GET /api/v1/leaderboard/stream` keeps one HTTP response open per viewer and writes an event
whenever the standings change, plus a `: ping` comment every 25 s. A reverse proxy must pass
those writes through at once and must not close a quiet connection.

The API already sends `X-Accel-Buffering: no` on the stream, which turns off Nginx buffering
for it. Still give the stream its own location so the timeouts apply:

```nginx
location = /api/v1/leaderboard/stream {
    proxy_pass http://orghive_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    # Longer than the 25 s heartbeat, so only a dead connection times out.
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

- **`TRUST_PROXY` must be set** (`apps/api/.env`) to the proxy hops in front of the API.
  Without it every viewer appears to come from the proxy's IP, and the per-IP cap below
  would be reached after the first 50 viewers of the whole site.
- **Limits per API instance** (`STREAM_LIMITS`, `apps/api/src/lib/leaderboard-stream.ts`):
  50 open streams per client IP (generous, since a campus often shares one IP) and 2,000 in
  total. Past either, the API answers 429 and the web app polls `GET /api/v1/leaderboard`
  every 60 s instead. Each API instance can hold its own 2,000; Redis pub/sub
  (`leaderboard:changed`) tells every instance about a change.
- **Node** keeps idle connections open by default (`server.timeout` is 0). Do not lower it
  below the heartbeat.
- **HTTP/2** at the proxy lifts the browser's limit of 6 connections per origin, so a viewer
  with many tabs open does not starve the app's other requests.
- On shutdown the API ends every stream first; browsers reconnect (after the 5 s `retry`) to
  another instance.
