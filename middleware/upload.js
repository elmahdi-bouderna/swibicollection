const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
const tempDir = path.join(__dirname, '../temp');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Configure storage for local uploads (when needed)
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    // Generate unique filename
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `image-${uniquePrefix}${path.extname(file.originalname)}`);
  }
});

// Configure storage for temporary uploads (for ImgBB)
const tempStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, tempDir);
  },
  filename: function(req, file, cb) {
    // Generate unique filename
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `temp-${uniquePrefix}${path.extname(file.originalname)}`);
  }
});

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  // Debug
  console.log('Processing file upload:', file);
  
  // Accept only image files
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// Configure multer for regular uploads
const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Configure multer with temporary storage for ImgBB uploads
const uploadTemp = multer({ 
  storage: tempStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

module.exports = {
  upload,
  uploadTemp
};