import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    /**
     * The record grows without bound, and the page grows with it: the smoke tests parse
     * and run a document that was 600 kB in July and is near four megabytes now. The
     * five-second default is a limit on the dataset, not on the code, and it stopped a
     * collection run that had already done its work.
     *
     * Slow tests are still worth noticing, so this is generous rather than unlimited —
     * anything approaching it is a real problem, not a large archive.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
