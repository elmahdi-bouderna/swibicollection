const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Set up Socket.io with CORS enabled
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "https://swibi.bouderna.me", "https://swibi.vercel.app"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Store authenticated admin connections
const adminSockets = new Set();

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Authenticate admin users
  socket.on('admin:authenticate', (token) => {
    // Here you would verify the token
    // For simplicity, we'll just add them to the admin set
    console.log('Admin authenticated:', socket.id);
    adminSockets.add(socket.id);
    
    // Use a different event type for connection confirmation
    socket.emit('connection_status', {
      status: 'connected',
      message: 'Connected to real-time notifications'
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    adminSockets.delete(socket.id);
  });
});

// Make io accessible to routes
app.set('io', io);
app.set('adminSockets', adminSockets);

// Debug uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Middleware
app.use(cors());

// Custom CORS configuration for direct downloads
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', true);
  
  // Handle OPTIONS method
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Important: For JSON requests only, not for multipart/form-data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve exported files from the temp directory
app.use('/temp', express.static(path.join(__dirname, 'temp')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/banners', require('./routes/banners'));
app.use('/api/orders', require('./routes/orders'));

// Improved error handling
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({
    error: 'Server error',
    details: err.message
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
