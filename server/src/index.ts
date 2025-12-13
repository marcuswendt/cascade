import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { projectsRouter } from './routes/projects.js';
import { assetsRouter } from './routes/assets.js';
import { aiRouter } from './routes/ai.js';
import { setupWebSocket } from './services/websocket.js';

const app = express();
const PORT = 3030;
const WS_PORT = 3031;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/projects', assetsRouter);
app.use('/api/ai', aiRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1' });
});

// Create HTTP server
const server = createServer(app);

// Setup WebSocket server
const wss = new WebSocketServer({ port: WS_PORT });
setupWebSocket(wss);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Cascade Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server running on ws://localhost:${WS_PORT}`);
});

