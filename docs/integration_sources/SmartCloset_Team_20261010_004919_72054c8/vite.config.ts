import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { host: '127.0.0.1', port: 4311, strictPort: true, watch: {ignored:['**/evidence/**','**/checkpoints/**','**/tmp/**']}, proxy:{'/api':{target:'http://127.0.0.1:4312',changeOrigin:false}} } });
