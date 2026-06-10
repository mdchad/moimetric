import { getRequest } from '@tanstack/react-start/server';
import { resolveUserWorkspace, type Workspace } from '#src/webapp/data/workspace.ts';
import { getAuth } from '#src/webapp/integrations/auth/server.ts';

// Server-only (.server.ts): uses @tanstack/react-start/server. Must only be
// referenced inside server-fn handlers / API routes — never top-level in client code.

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export const readSessionUser = async (): Promise<SessionUser | null> => {
  const request = getRequest();
  if (!request) {
    return null;
  }
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return null;
  }
  const { id, name, email, image } = session.user;
  return { id, name, email, image: image ?? null };
};

// Tenant guard for scoped handlers: resolves the signed-in user + workspace, or
// throws. NEVER trust a client-supplied org/product id.
export const requireUserWorkspace = async (): Promise<{ user: SessionUser } & Workspace> => {
  const user = await readSessionUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  const workspace = await resolveUserWorkspace(user.id);
  if (!workspace) {
    throw new Error('No workspace for user');
  }
  return { user, ...workspace };
};
