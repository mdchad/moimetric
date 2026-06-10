import { createServerFn } from '@tanstack/react-start';
import { readSessionUser, type SessionUser } from '#src/webapp/data/session.server.ts';

export type { SessionUser };

// Client-callable: returns the signed-in user (or null). The server-only
// readSessionUser is referenced only inside this handler, so it's stripped from
// the client bundle.
export const getSessionUser = createServerFn({ method: 'GET' }).handler(async () => readSessionUser());
