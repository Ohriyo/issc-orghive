import type { Request, RequestHandler, Response } from 'express';
import {
  ACTING_AS_HEADER,
  actingAsRequestSchema,
  actingAsSchema,
  ErrorCode,
  slugParamsSchema,
  updateProfileRequestSchema,
  uploadConstitutionRequestSchema,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { authOf, maybeAuthOf, orgOf } from '#src/middleware/require-auth';
import type { ConstitutionService } from '#src/services/constitution.service';
import type { Actor } from '#src/services/document.service';
import type { ProfileService } from '#src/services/profile.service';

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

/**
 * Raw image bodies cannot carry JSON, so "Acting as" comes in its own header,
 * percent-encoded (header values are Latin-1 only; names need not be).
 */
function actingAsHeader(req: Request): string {
  let value: string | undefined;
  try {
    value = decodeURIComponent(req.get(ACTING_AS_HEADER) ?? '');
  } catch {
    value = undefined;
  }
  const parsed = actingAsSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, `actingAs: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

/** The raw image bytes (express.raw on the route); the service checks what they are. */
function imageOf(req: Request, field: 'logo' | 'cover'): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, `${field}: Send a PNG, JPEG or WebP image`);
  }
  return req.body;
}

export function createProfileController(
  profiles: ProfileService,
  constitutions: ConstitutionService,
) {
  const get: RequestHandler = async (_req, res) => {
    res.json(await profiles.get(orgOf(res)));
  };

  const save: RequestHandler = async (req, res) => {
    const body = updateProfileRequestSchema.parse(req.body);
    res.json(await profiles.save(actorOf(req, res), orgOf(res), body));
  };

  const setLogo: RequestHandler = async (req, res) => {
    const actingAs = actingAsHeader(req);
    res.json(await profiles.setLogo(actorOf(req, res), orgOf(res), imageOf(req, 'logo'), actingAs));
  };

  const setCover: RequestHandler = async (req, res) => {
    const actingAs = actingAsHeader(req);
    res.json(
      await profiles.setCover(actorOf(req, res), orgOf(res), imageOf(req, 'cover'), actingAs),
    );
  };

  const removeCover: RequestHandler = async (req, res) => {
    const { actingAs } = actingAsRequestSchema.parse(req.body);
    res.json(await profiles.removeCover(actorOf(req, res), orgOf(res), actingAs));
  };

  const getConstitution: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    res.json(await constitutions.get({ userId: maybeAuthOf(res)?.userId, ip: req.ip }, slug));
  };

  const uploadConstitution: RequestHandler = async (req, res) => {
    const body = uploadConstitutionRequestSchema.parse(req.body);
    res.status(201).json(await constitutions.upload(actorOf(req, res), orgOf(res), body));
  };

  return { get, save, setLogo, setCover, removeCover, getConstitution, uploadConstitution };
}
