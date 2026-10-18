import type { LensContext, LensSignals } from '../src/types/lens'

export const sampleSignals = (overrides: Partial<LensSignals> = {}): LensSignals => ({
  sizeClass: 'term',
  copiedWithinMs: null,
  dwellMs: 1500,
  reselectCount: 0,
  reread: 0,
  rarity: 0.8,
  knownTerm: false,
  topicFamiliarity: null,
  foreignLanguage: false,
  blocked: null,
  ...overrides
})

export const sampleContext = (overrides: Partial<LensContext> = {}): LensContext => ({
  span: 'heteroscedasticity',
  paragraph: 'The residuals show heteroscedasticity, so the standard errors are unreliable.',
  headingPath: ['Regression diagnostics'],
  title: 'A gentle guide to regression',
  lang: 'en',
  site: 'example.com',
  siteCategory: 'general',
  surface: 'html',
  signals: sampleSignals(),
  p: 0.8,
  ...overrides
})
