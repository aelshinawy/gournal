import { z } from 'zod';
import { ACTIVITY_TYPES } from './activity';

export const ActivitySchema = z.object({
  id: z.string().describe('Unique id of the activity item.'),
  createdAt: z.string().describe('When gournal stored the item, as an ISO timestamp.'),
  updatedAt: z.string().describe('When the item last changed, as an ISO timestamp.'),
  deletedAt: z.string().nullable().describe('When the item was deleted, or null.'),
  deviceId: z.string().describe('Id of the device that stored the item.'),
  type: z.enum(ACTIVITY_TYPES).describe('Kind of activity: a commit, an opened PR, a merged PR, or a review.'),
  occurredAt: z.string().describe('When the activity happened on GitHub, as an ISO timestamp.'),
  repo: z.string().describe('Repository (owner/name).'),
  branch: z.string().nullable().describe('Git branch of the PR, or null.'),
  externalId: z.string().describe('Id of the item on GitHub: the PR number, commit hash, or review id.'),
  title: z.string().nullable().describe('PR title or first line of the commit message, or null.'),
  url: z.string().nullable().describe('GitHub URL of the item, or null.'),
  capturedBy: z.literal('github').describe('Where the item came from. Always github.'),
  pr: z.number().nullable().describe('PR number that the item belongs to, or null.'),
  payload: z.record(z.string(), z.unknown()).describe('Extra data from GitHub, for example the review state.'),
});
export type ActivityJson = z.infer<typeof ActivitySchema>;
