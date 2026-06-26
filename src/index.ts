import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {corsMiddleware} from "./middleware/cors.middleware.js";
import {env} from "./config/env.js";
import {rateLimitMiddleware} from "./middleware/rate-limit.middleware.js";
import {appTokenMiddleware} from "./middleware/app-token.middleware.js";
import {authRoutes} from "./routes/auth.route.js";
import {databaseRoutes} from "./routes/database.route.js";
import { logger } from "hono/logger";
import {errorHandler} from "./middleware/error-handler.middleware.js";
import {storageRoutes} from "./routes/storage.route.js";
import {pdfRoutes} from "./routes/pdf.route.js";

const app = new Hono()

if (process.env.NODE_ENV !== 'production') {
  app.use('*', logger());
}

app.use('*', ...corsMiddleware);
app.use('*', rateLimitMiddleware);
app.use('*', appTokenMiddleware);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));
app.route('/api/auth', authRoutes);
app.route('/api/db',   databaseRoutes);
app.route('/api/storage', storageRoutes);
app.route('/api/invoices', pdfRoutes);

app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));
app.onError(errorHandler);

serve({fetch: app.fetch, port: env.PORT}, (info) => {
  console.log(`🚀 Hono proxy démarré sur http://localhost:${env.PORT}`);
})
