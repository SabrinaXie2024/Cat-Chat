import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { resetDb } from '../mocks/handlers'
import { server } from '../mocks/node'

// Whole-app renders can exceed the 1s default on a cold first run.
configure({ asyncUtilTimeout: 3000 })

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetDb()
})
afterAll(() => server.close())
