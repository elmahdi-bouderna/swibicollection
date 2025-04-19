const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// ImgBB API Key
const IMGBB_API_KEY = process.env.IMGBB_API_KEY; // Add this to your .env file

/**
 * Upload image to ImgBB
 * @param {string} filePath - Path to the temporary file
 * @param {string} name - Optional name for the image
 * @returns {Promise<string>} - URL of the uploaded image
 */
async function uploadImage(filePath, name = '') {
  try {
    const formData = new FormData();
    formData.append('image', fs.createReadStream(filePath));
    
    if (name) {
      formData.append('name', name);
    }
    
    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, formData, {
      headers: {
        ...formData.getHeaders()
      }
    });
    
    if (response.data.success) {
      // Return the direct image URL
      return response.data.data.url;
    } else {
      throw new Error('Failed to upload image to ImgBB');
    }
  } catch (error) {
    console.error('Error uploading to ImgBB:', error);
    throw error;
  }
}

module.exports = {
  uploadImage
};