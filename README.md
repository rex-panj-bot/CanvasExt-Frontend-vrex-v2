# Canvas Extension Frontend

Chrome extension frontend for the Canvas LMS AI Study Assistant. Extracts course materials from Canvas and provides an AI-powered study interface.

## Features

- Automatic course material extraction from Canvas LMS
- PDF, document, and file upload support
- Real-time AI chat interface
- Citation system with clickable PDF references
- Multiple authentication methods (Session, OAuth, API Token)
- Configurable backend URL

## Prerequisites

- Google Chrome or Chromium-based browser
- Backend server running ([Canvas Extension Backend](https://github.com/RushilRandhar/CanvasExt-backend))

## Installation

### 1. Download the Extension

Download the latest release or clone this repository:

```bash
git clone https://github.com/RushilRandhar/CanvasExt-Frontend.git
cd CanvasExt-Frontend
```

### 2. Load in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the extension folder
5. Pin the extension to your toolbar for easy access

### 3. Configure Backend URL (Optional)

The extension defaults to `http://localhost:8000` for local development.

To use a different backend, edit `utils/config.js`:

```javascript
static DEFAULT_BACKEND_URL = 'https://your-backend.com';
```

## Usage

### Scanning Course Materials

1. Navigate to any Canvas course page
2. Click the Canvas Extension icon
3. Click "Scan Materials" to extract PDFs, files, and documents
4. Select which materials to upload
5. Click "Upload to Study Bot"

### Chatting with Your Materials

1. After uploading materials, click "Open Study Bot"
2. Ask questions about your course materials
3. Receive AI-generated responses with citations
4. Click citations to view the source PDF at the exact page

## Backend Setup

This extension requires the backend server. See [CanvasExt-backend](https://github.com/RushilRandhar/CanvasExt-backend) for setup instructions.

## Project Structure

```
├── manifest.json              # Extension manifest
├── popup/                     # Extension popup UI
├── chat/                      # Chat interface
├── background/                # Service worker
├── content/                   # Canvas page integration
├── utils/                     # Utilities & API clients
├── lib/                       # Third-party libraries
└── icons/                     # Extension icons
```

## Support

- **Backend Issues**: [CanvasExt-backend](https://github.com/RushilRandhar/CanvasExt-backend)
- **Extension Issues**: [Open an issue](https://github.com/RushilRandhar/CanvasExt-Frontend/issues)

## License

MIT License
