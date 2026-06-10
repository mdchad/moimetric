import { createFileRoute } from '@tanstack/react-router';
import { getAuth } from '#src/webapp/integrations/auth/server.ts';

async function handler({ request }: { request: Request }) {
  const auth = await getAuth();
  return auth.handler(request);
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handler, POST: handler } },
});
