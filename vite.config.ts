import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          if (id.includes('/game/levels/tactics/')) return 'level-tactics';
          if (id.includes('/game/levels/scouting/')) return 'level-scouting';
          if (id.includes('/game/levels/transfers/')) return 'level-transfers';
          if (id.includes('/game/levels/squad/')) return 'level-squad';
          return undefined;
        },
      },
    },
  },
});
