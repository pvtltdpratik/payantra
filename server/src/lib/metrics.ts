/**
 * Minimal, dependency-free metrics in the Prometheus text format — enough for CloudWatch agent / Grafana Agent /
 * Datadog's OpenMetrics check to scrape, without tying the code to any of them. Counters live in this process only,
 * so a scraper must collect from every instance (or use the access-log line instead).
 *
 * Labels are kept low-cardinality on purpose: the ROUTE PATTERN ("/api/v1/orders/:id"), never the raw URL.
 */
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Series {
  count: number;
  sum: number;
  buckets: number[];
}

const requests = new Map<string, Series>();
let startedAt = Date.now();

export function recordRequest(method: string, route: string, status: number, seconds: number) {
  const key = `${method}\u0000${route}\u0000${status}`;
  let s = requests.get(key);
  if (!s) {
    // Hard cap so a bug (or an attacker generating unique "routes") cannot grow memory without bound.
    if (requests.size >= 2000) return;
    s = { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
    requests.set(key, s);
  }
  s.count++;
  s.sum += seconds;
  BUCKETS.forEach((b, i) => {
    if (seconds <= b) s.buckets[i]++;
  });
}

export function resetMetrics() {
  requests.clear();
  startedAt = Date.now();
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export function renderMetrics(extra: { release?: string } = {}): string {
  const out: string[] = [];
  const mem = process.memoryUsage();

  out.push('# HELP payantra_http_requests_total HTTP requests handled.', '# TYPE payantra_http_requests_total counter');
  for (const [key, s] of requests) {
    const [method, route, status] = key.split('\u0000');
    out.push(`payantra_http_requests_total{method="${esc(method)}",route="${esc(route)}",status="${status}"} ${s.count}`);
  }

  out.push('# HELP payantra_http_request_duration_seconds HTTP request duration.', '# TYPE payantra_http_request_duration_seconds histogram');
  for (const [key, s] of requests) {
    const [method, route, status] = key.split('\u0000');
    const labels = `method="${esc(method)}",route="${esc(route)}",status="${status}"`;
    BUCKETS.forEach((b, i) => out.push(`payantra_http_request_duration_seconds_bucket{${labels},le="${b}"} ${s.buckets[i]}`));
    out.push(`payantra_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${s.count}`);
    out.push(`payantra_http_request_duration_seconds_sum{${labels}} ${s.sum}`);
    out.push(`payantra_http_request_duration_seconds_count{${labels}} ${s.count}`);
  }

  out.push('# TYPE payantra_process_uptime_seconds gauge', `payantra_process_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`);
  out.push('# TYPE payantra_process_resident_memory_bytes gauge', `payantra_process_resident_memory_bytes ${mem.rss}`);
  out.push('# TYPE payantra_process_heap_used_bytes gauge', `payantra_process_heap_used_bytes ${mem.heapUsed}`);
  out.push('# TYPE payantra_build_info gauge', `payantra_build_info{release="${esc(extra.release ?? 'unknown')}"} 1`);
  return `${out.join('\n')}\n`;
}
