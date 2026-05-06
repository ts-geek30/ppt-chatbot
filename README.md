# SlideAI - PPT Content Mapper

An AI-powered chatbot that intelligently maps raw data to PowerPoint slide structures using LangChain and NVIDIA LLMs.

## Features

- 📊 Upload your PPT template and extract slide structure
- 🤖 AI agent analyzes and maps raw content to appropriate slides
- 🎯 Real-time agent step tracking (Reading → Analyzing → Mapping → Refining)
- 💬 Interactive chat interface with slide detail popups
- 🔍 LangSmith integration for observability
- 🎨 Modern dark UI with responsive design

---

## Architecture

```
User uploads .pptx
    ↓
python-pptx extracts slide structure (titles, layouts, text)
    ↓
Stored in session (in-memory)
    ↓
User pastes raw data
    ↓
LangChain agent (NVIDIA LLM) maps content to slides
    ↓
Streams progress steps via SSE
    ↓
Returns structured JSON with slide mappings
```

---

## Tech Stack

**Backend:**
- FastAPI (Python web framework)
- LangChain (agent orchestration)
- python-pptx (PPT parsing)
- NVIDIA AI (LLM provider)
- LangSmith (observability)

**Frontend:**
- React + Vite
- Vanilla CSS-in-JS
- Server-Sent Events (SSE) for streaming

---

## Prerequisites

- Python 3.12+
- Node.js 18+
- NVIDIA API key ([get one here](https://build.nvidia.com/))
- LangSmith account (optional, for tracing)

---

## Installation & Setup

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd ppt-chatbot
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Create a `.env` file in the `backend/` directory:

```bash
# backend/.env
NVIDIA_API_KEY=your_nvidia_api_key_here
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# LangSmith (optional - for tracing)
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=your_langsmith_api_key_here
LANGSMITH_PROJECT=SlideAi
```

**Get your API keys:**
- NVIDIA: https://build.nvidia.com/
- LangSmith: https://smith.langchain.com/

### 4. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install
```

---

## Running the Application

You need **two terminals** — one for backend, one for frontend.

### Terminal 1 - Backend

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload
```

Backend runs at: **http://localhost:8000**

### Terminal 2 - Frontend

```bash
cd frontend
npm run dev
```

Frontend runs at: **http://localhost:3000**

Open your browser at **http://localhost:3000**

---

## Usage

### Step 1: Upload PPT Template
1. Click "Upload Your PPT Template"
2. Drag & drop or browse for a `.pptx` file
3. The agent extracts slide structure (titles, layouts, placeholders)

### Step 2: Map Your Content
1. Paste raw data in the chat input (company info, stats, bullet points, etc.)
2. Press **Ctrl + Enter** or click **Send**
3. Watch the agent work through steps:
   - 📄 Reading your raw data
   - 🔍 Analyzing slide structure
   - 🗂️ Mapping content to slides
   - ✨ Refining and formatting output
4. Click any slide card to see full details in a popup
5. Copy content directly from the popup

---

## Project Structure

```
ppt-chatbot/
├── backend/
│   ├── main.py              # FastAPI app + routes
│   ├── agent.py             # LangChain agent logic
│   ├── ppt_parser.py        # python-pptx slide extraction
│   ├── requirements.txt     # Python dependencies
│   ├── .env                 # Environment variables (not in git)
│   └── .gitignore
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main layout + sidebar
│   │   ├── ChatWindow.jsx   # Chat UI + SSE streaming
│   │   └── UploadTemplate.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md
```

---

## API Endpoints

### `GET /new-session`
Returns a unique session ID for the user.

**Response:**
```json
{ "session_id": "uuid-here" }
```

### `POST /upload-template`
Uploads and parses a PPT file.

**Form Data:**
- `file`: .pptx file
- `session_id`: user session ID

**Response:**
```json
{
  "message": "Template uploaded and parsed successfully",
  "session_id": "uuid",
  "slides_detected": 8,
  "slide_structure": "Slide 1 (Layout: Title Slide)\n  - Company Name\n..."
}
```

### `POST /process-data` (SSE Stream)
Maps raw data to slides with real-time progress.

**Body:**
```json
{
  "session_id": "uuid",
  "raw_data": "Your raw content here..."
}
```

**SSE Events:**
```
data: {"type": "step", "step": "reading", "label": "Reading your raw data..."}
data: {"type": "step", "step": "analyzing", "label": "Analyzing slide structure..."}
data: {"type": "result", "data": {"slides": [...]}}
```

---

## Configuration

### Change LLM Model

Edit `backend/agent.py`:

```python
llm = ChatOpenAI(
    model="meta/llama-3.1-405b-instruct",  # Change this
    temperature=0.2,
    api_key=openai_api_key,
    base_url=base_url
)
```

Available NVIDIA models:
- `meta/llama-3.1-405b-instruct`
- `nvidia/llama-3.1-nemotron-70b-instruct`
- `mistralai/mixtral-8x7b-instruct-v0.1`

### Adjust Agent Steps

Edit `backend/agent.py`:

```python
AGENT_STEPS = [
    {"step": "reading",    "label": "Reading your raw data..."},
    {"step": "analyzing",  "label": "Analyzing slide structure..."},
    {"step": "mapping",    "label": "Mapping content to slides..."},
    {"step": "refining",   "label": "Refining and formatting output..."},
]
```

---

## Troubleshooting

### Backend won't start

**Error:** `externally-managed-environment`
```bash
# Install python3-venv first
sudo apt install python3.12-venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Error:** `NVIDIA_API_KEY not set`
- Make sure `.env` file exists in `backend/` directory
- Check that `python-dotenv` is installed
- Restart the server after adding the key

### Frontend can't connect to backend

- Make sure backend is running on `http://localhost:8000`
- Check CORS settings in `backend/main.py` (should allow `*` for dev)
- Open browser console to see network errors

### PPT upload fails

- Only `.pptx` files are supported (not `.ppt`)
- File must be a valid PowerPoint file
- Check backend logs for parsing errors

### LangSmith not showing traces

- Verify `LANGSMITH_TRACING=true` in `.env`
- Check API key is correct
- Restart backend after adding LangSmith vars
- Visit https://smith.langchain.com/ to see traces

---

## Development

### Run backend in debug mode

```bash
uvicorn main:app --reload --log-level debug
```

### Build frontend for production

```bash
cd frontend
npm run build
```

Output goes to `frontend/dist/`

---

## Security Notes

- `.env` file is in `.gitignore` — never commit API keys
- In production, replace in-memory session store with Redis/DB
- Tighten CORS settings in `main.py` for production
- Add rate limiting for API endpoints
- Validate file uploads (size limits, virus scanning)

---

## License

MIT

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## Support

For issues or questions:
- Open a GitHub issue
- Check LangSmith traces for debugging
- Review backend logs for errors

---

## Roadmap

- [ ] Add support for Google Slides
- [ ] Export mapped content back to PPT
- [ ] Multi-language support
- [ ] Slide preview thumbnails
- [ ] Collaborative sessions
- [ ] Template library

---

**Built with ❤️ using LangChain, NVIDIA AI, and React**
