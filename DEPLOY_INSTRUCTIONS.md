# Deploying to Glitch

Follow these steps to deploy the beauty shop server to Glitch:

## Step 1: Setup Glitch Project
1. Go to [Glitch](https://glitch.com) and sign in
2. Open your existing project at https://swibi.glitch.me or create a new one
3. If creating a new one, select "Import from GitHub" if available, or "New Project" > "hello-webpage"

## Step 2: Upload Your Code
### Option A: GitHub Import
If you've pushed your code to GitHub:
1. In your Glitch project, click "Tools" at the bottom
2. Select "Import and Export"
3. Choose "Import from GitHub"
4. Enter your repository URL and click "Import"

### Option B: Manual Upload
If you don't have a GitHub repository:
1. In your Glitch project, click "Assets" at the left sidebar
2. Click "Upload" and select all files from your local server folder
3. Alternatively, you can drag and drop files directly into the Glitch editor

## Step 3: Package.json Fix
We already fixed the axios version in package.json to use version 0.21.4 instead of 1.6.2, as Glitch uses an older Node.js version that doesn't support ES modules.

## Step 4: Environment Variables
1. Click on ".env" in the Glitch editor
2. Ensure all variables from your local .env file are added:
   - DB_HOST
   - DB_USER
   - DB_PASSWORD
   - DB_NAME
   - IMGBB_API_KEY
   - JWT_SECRET

## Step 5: Start Your App
1. Click on "package.json" and ensure the "start" script is set to: `"start": "node server.js"`
2. Glitch will automatically run this start script and restart when files change

## Troubleshooting
- If you see errors in the Glitch logs, check the console by clicking "Logs" at the bottom
- If you're still having issues with axios, try clearing the node_modules folder and letting Glitch reinstall dependencies
- For database connection issues, verify your database credentials in the .env file

## Next Steps
Once your server is running on Glitch, make sure your client application is configured to connect to https://swibi.glitch.me as the API endpoint. 