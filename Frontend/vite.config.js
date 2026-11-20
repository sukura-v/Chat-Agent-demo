import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const API_TARGET = env.VITE_API_BASE_URL || 'http://localhost:8000'

  return {
    plugins: [
      vue(),
      AutoImport({
        resolvers: [ElementPlusResolver()],
      }),
      Components({
        resolvers: [ElementPlusResolver()],
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      port: 5173,
      open: false,
      proxy: {
        '/auth':    { target: API_TARGET, changeOrigin: true },
        '/api':     { target: API_TARGET, changeOrigin: true },
        '/analyze': { target: API_TARGET, changeOrigin: true },
        '/analytics': { target: API_TARGET, changeOrigin: true },
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'echarts': ['echarts'],
            'vue-vendor': ['vue', 'vue-router', 'pinia'],
          }
        }
      }
    }
  }
})
