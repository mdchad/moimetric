import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { getSessionUser } from '#src/webapp/data/auth.ts';
import { authClient } from '#src/webapp/integrations/auth/client.ts';

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const user = await getSessionUser();
    if (user) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const [pending, setPending] = useState(false);

  const signIn = () => {
    setPending(true);
    void authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' });
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Sign in to Moimetric
        </h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Consolidate your product metrics in one dashboard.
        </p>
        <button
          type="button"
          onClick={signIn}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {pending ? 'Redirecting…' : 'Continue with Google'}
        </button>
      </div>
    </div>
  );
}
