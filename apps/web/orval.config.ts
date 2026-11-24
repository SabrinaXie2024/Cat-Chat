import { defineConfig } from 'orval'

export default defineConfig({
  catChat: {
    input: { target: '../../packages/api-spec/openapi.yaml' },
    output: {
      mode: 'tags-split',
      target: 'src/api/generated',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      mock: true,
      clean: true,
      override: {
        mutator: { path: 'src/api/http.ts', name: 'http' },
      },
    },
  },
})
