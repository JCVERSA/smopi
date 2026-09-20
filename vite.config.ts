import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': import.meta.dirname,
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Split rarely-changing vendor code into its own long-lived chunks so
          // an app-code deploy doesn't invalidate the whole ~740 KB bundle in
          // browser caches. These libs all render on first paint, so they are
          // deliberately NOT lazy-loaded (that would cause visible pop-in);
          // splitting only improves cache reuse, not initial transfer size.
          // Vite 8 / Rolldown requires the function form.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (id.includes('matter-js')) return 'physics';
            if (/micromark|mdast|remark|hast|unified|vfile|react-markdown|property-information/.test(id)) {
              return 'markdown';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
