import { defineConfig } from 'orval'

export default defineConfig({
  catChat: {
    input: {
      target: '../../packages/api-spec/openapi.yaml',
      // getVideo is a Range-capable stream consumed by <video src>, not the client.
      filters: { mode: 'exclude', tags: ['media-stream'] },
    },
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
