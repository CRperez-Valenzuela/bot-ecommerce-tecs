import { Router } from 'express';
import type { GeminiService } from '../ai/GeminiService';
import { asyncHandler } from '../middleware/errorHandler';
import type { IInventoryRepository } from '../repositories/IInventoryRepository';
import type { SessionStore } from '../services/SessionStore';
import { AppError } from '../utils/errors';

export interface HealthDeps {
  repository: IInventoryRepository;
  gemini: GeminiService;
  sessions: SessionStore;
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();

  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const repository = await deps.repository.healthCheck();
      if (!repository.ok) {
        throw new AppError('REPOSITORY_ERROR', 'La capa de datos no esta disponible', 503, { ...repository });
      }
      res.json({
        success: true,
        data: {
          status: 'ok',
          mode: repository.mode,
          repository: repository.detail,
          geminiConfigured: deps.gemini.configured,
          activeSessions: deps.sessions.size(),
          uptimeSeconds: Math.round(process.uptime()),
        },
      });
    }),
  );

  return router;
}
