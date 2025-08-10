# Metrics and Observability

This document summarises the Prometheus metrics exposed by the backend and how they
are instrumented.  All counters, histograms and gauges are defined in
`middleware/metrics.js` and registered on a custom Prometheus registry.  To
consume these metrics point your Prometheus scrape configuration at the
`/metrics` endpoint exposed by the Express server.  The endpoint can be
protected with API keys and IP allow‑lists as described below.

## Metrics Endpoint

The backend exposes a single endpoint at `/metrics` that returns metrics in the
Prometheus exposition format.  The handler performs optional API key and
allow‑list checks:

* **Authentication** – if the environment variable `METRICS_API_KEY` is set,
  clients must include a matching `x-api-key` header in their request.  If the
  key does not match, the endpoint returns `403`【665845919011301†L248-L254】.
* **Authorisation** – if `METRICS_ALLOW_IPS` is set to a comma‑separated list
  of CIDR blocks or individual IP addresses, requests from outside these
  addresses are rejected with `403`【665845919011301†L256-L264】.

Use the following curl command to scrape metrics when both variables are set:

```sh
curl -H "x-api-key: $METRICS_API_KEY" http://localhost:PORT/metrics
```

## Metric Categories

The following tables list the built‑in metrics.  Each metric is labelled to
allow fine‑grained aggregation in dashboards and alerts.

### HTTP Server Metrics

| Name                            | Type      | Labels                 | Description |
|---------------------------------|-----------|------------------------|-------------|
| `http_requests_total`           | Counter   | `route`, `method`, `status` | Counts total HTTP requests served by route and status【665845919011301†L38-L46】. |
| `http_errors_total`             | Counter   | `route`, `method`, `status` | Counts non‑2xx HTTP responses【665845919011301†L49-L53】. |
| `http_request_duration_seconds` | Histogram | `route`, `method`           | Distribution of request latencies (seconds) using custom buckets【665845919011301†L55-L63】. |

### Strategy Loop Metrics

| Name                                | Type      | Labels    | Description |
|-------------------------------------|-----------|-----------|-------------|
| `strategy_loop_duration_seconds`    | Histogram | `strategy` | Measures the duration of each strategy loop iteration (seconds)【665845919011301†L66-L72】. |

Call `recordStrategyLoop(strategy, durationMs)` to record a loop duration.  The
helper converts milliseconds to seconds and observes the histogram【665845919011301†L285-L288】.

### Circuit Breaker Metrics

| Name                 | Type    | Labels    | Description |
|----------------------|---------|-----------|-------------|
| `circuit_open_total` | Counter | `service` | Number of times a circuit breaker transitioned to the OPEN state【665845919011301†L76-L87】. |
| `circuit_half_open_total` | Counter | `service` | Number of times a circuit transitioned to HALF_OPEN【665845919011301†L82-L85】. |
| `circuit_closed_total` | Counter | `service` | Number of times a circuit transitioned to CLOSED【665845919011301†L87-L89】. |
| `breaker_open_ratio` | Gauge   | `service` | Fraction of calls short‑circuited by the breaker【665845919011301†L91-L98】. |

Use `recordCircuitBreakerEvent(event, service)` to increment the appropriate
counter【665845919011301†L294-L309】, and `updateBreakerOpenRatio(service, ratio)` to set
the gauge【665845919011301†L316-L327】.

### Cache Metrics

| Name                | Type    | Labels | Description |
|---------------------|---------|--------|-------------|
| `cache_hits_total`  | Counter | `cache` | Total cache hits【665845919011301†L102-L107】. |
| `cache_misses_total`| Counter | `cache` | Total cache misses【665845919011301†L106-L110】. |
| `cache_hit_ratio`   | Gauge   | `cache` | Cache hit ratio (hits / (hits + misses))【665845919011301†L112-L116】. |

Call `recordCacheHit(cache)` and `recordCacheMiss(cache)` to record hits and
misses.  The helpers automatically update the ratio【665845919011301†L346-L356】.

### Queue Metrics

| Name         | Type  | Labels | Description |
|--------------|-------|--------|-------------|
| `queue_depth`| Gauge | `name` | Current depth of job or strategy queues【665845919011301†L119-L125】. |

Use `setQueueDepth(name, depth)` whenever the queue length changes【665845919011301†L360-L371】.

### WebSocket Metrics

| Name                 | Type  | Labels | Description |
|----------------------|-------|--------|-------------|
| `ws_disconnect_ratio`| Gauge | *(none)* | Ratio of WebSocket disconnections to connections【665845919011301†L129-L135】. |

Record the ratio by calling `recordWsDisconnect(totalConnections, totalDisconnections)`【665845919011301†L375-L387】.

### External Request Metrics

| Name                                 | Type      | Labels           | Description |
|--------------------------------------|-----------|------------------|-------------|
| `external_request_duration_seconds`  | Histogram | `service`        | Duration of outbound HTTP calls to third‑party services【665845919011301†L161-L166】. |
| `external_requests_total`            | Counter   | `service`, `status` | Total external HTTP requests【665845919011301†L166-L171】. |
| `external_errors_total`              | Counter   | `service`, `status` | Total failed external HTTP requests【665845919011301†L172-L176】. |

Call `recordExternalRequest(service, status, durationMs, error)` to log
latency and errors【665845919011301†L391-L407】.

## Environment Variables

| Variable           | Required | Default | Description |
|--------------------|----------|---------|-------------|
| `METRICS_API_KEY`  | Optional | *(none)*| API key required to access `/metrics`【665845919011301†L248-L254】. |
| `METRICS_ALLOW_IPS`| Optional | *(none)*| Comma‑separated list of CIDR blocks/IPs allowed to scrape metrics【665845919011301†L257-L264】. |

If `METRICS_API_KEY` is not provided the metrics endpoint is publicly accessible.
If `METRICS_ALLOW_IPS` is empty all IPs are allowed.

## Running the Metrics Server

Ensure the Express app mounts `httpMetricsMiddleware` before routes and
exposes `metricsEndpoint` at `/metrics`.  When running behind a reverse proxy
(e.g. Nginx or API gateway), remember to forward the `x-api-key` header and
client IP so the allow‑list logic works correctly.  For Kubernetes, you can
annotate the `Service` with `prometheus.io/scrape: "true"` and specify the
target port.

## Extending Metrics

When adding new features, prefer using existing helper functions to record
observations.  For example, record circuit breaker transitions in your
service wrapper rather than manually manipulating counters.  When defining
new metrics ensure names follow Prometheus best practices (lowercase with
underscores) and avoid high cardinality label values.  Register new metrics on
the shared registry (`register.registerMetric(...)`) so they are exported by
the `/metrics` endpoint【665845919011301†L137-L150】.