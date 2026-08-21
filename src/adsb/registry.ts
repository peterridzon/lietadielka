import { env } from '../lib/env.js'
import type { AdsbProvider } from './provider.js'
import { AdsbLolProvider } from './providers/adsblol.js'
import { OpenSkyProvider } from './providers/opensky.js'

const factories: Record<string, () => AdsbProvider> = {
  adsblol: () => new AdsbLolProvider(),
  opensky: () => new OpenSkyProvider(),
}

export function getProvider(name = env.adsbProvider): AdsbProvider {
  const factory = factories[name]
  if (!factory) {
    throw new Error(
      `Unknown ADS-B provider "${name}". Available: ${Object.keys(factories).join(', ')}`,
    )
  }
  return factory()
}

export function listProviders(): string[] {
  return Object.keys(factories)
}
