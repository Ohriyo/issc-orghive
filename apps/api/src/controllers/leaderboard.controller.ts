import type { RequestHandler } from 'express';
import { leaderboardQuerySchema, leaderboardStreamQuerySchema } from '@orghive/shared';
import type { LeaderboardStream } from '#src/lib/leaderboard-stream';
import type { PublicLeaderboardService } from '#src/services/public-leaderboard.service';

export function createLeaderboardController(
  leaderboard: Pick<PublicLeaderboardService, 'read' | 'semesterOf'>,
  stream: Pick<LeaderboardStream, 'open'>,
) {
  const read: RequestHandler = async (req, res) => {
    res.json(await leaderboard.read(leaderboardQuerySchema.parse(req.query)));
  };

  const live: RequestHandler = (req, res) => {
    const query = leaderboardStreamQuerySchema.parse(req.query);
    stream.open(req, res, leaderboard.semesterOf(query));
  };

  return { read, live };
}
