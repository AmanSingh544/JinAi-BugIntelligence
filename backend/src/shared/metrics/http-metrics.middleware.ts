import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Global HTTP metrics middleware.
 *
 * Records request count and duration with route-template labels
 * to avoid high cardinality from dynamic IDs in URLs.
 *
 * Excludes:
 * - /metrics and /api/v1/metrics (self-scrape)
 * - /health (cheap probe)
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  private readonly excludedPaths = new Set(['/metrics', '/health', '/api/v1/metrics']);

  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const route = this.getRouteTemplate(req);
    if (!route || this.excludedPaths.has(req.path) || this.excludedPaths.has(route)) {
      return next();
    }

    const end = this.metrics.httpRequestDuration.startTimer({
      method: req.method,
      route,
    });

    res.on('finish', () => {
      const status = res.statusCode.toString();
      this.metrics.httpRequestsTotal.inc({ method: req.method, route, status });
      end({ status });
    });

    next();
  }

  /**
   * Extract the route template from the Express request.
   * Falls back to the base URL path if no route is matched.
   */
  private getRouteTemplate(req: Request): string | undefined {
    // Express stores the matched route pattern on req.route.path
    const route = (req as unknown as { route?: { path?: string } }).route;
    if (route && typeof route.path === 'string') {
      return req.baseUrl + route.path;
    }
    // Fallback for unmatched routes — use baseUrl + path but strip query
    return req.path;
  }
}
