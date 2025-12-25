import {defineConfig} from 'vite'
import customTsConfig from 'vite-plugin-custom-tsconfig'

export default defineConfig({
  plugins: [
    customTsConfig({
      tsConfigPath: './tsconfig.build.json',
    }),
  ],
})
