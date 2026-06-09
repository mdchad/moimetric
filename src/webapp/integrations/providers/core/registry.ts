import { createFathomAdapter } from '#src/webapp/integrations/providers/fathom/index.ts';
import { createPlausibleAdapter } from '#src/webapp/integrations/providers/plausible/index.ts';
import type { AdapterDeps, AdapterFactory, MetricSourceAdapter } from './adapter.ts';
import { permanentError } from './errors.ts';
import type { ProviderId } from './types.ts';

// The single allow-list of providers. Add a new provider here + its folder.
const providerRegistry: Partial<Record<ProviderId, AdapterFactory>> = {
  plausible: createPlausibleAdapter as AdapterFactory,
  fathom: createFathomAdapter as AdapterFactory,
};

export const getAdapter = (id: ProviderId, deps?: AdapterDeps): MetricSourceAdapter => {
  const factory = providerRegistry[id];
  if (!factory) {
    throw permanentError(`No adapter registered for provider ${id}`);
  }
  return factory(deps);
};

export const registeredProviders = (): ProviderId[] =>
  Object.keys(providerRegistry) as ProviderId[];
