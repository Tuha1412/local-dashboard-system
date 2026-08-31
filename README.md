# 🚀 Local System Performance Monitor Dashboard

A modern, high-performance real-time system performance monitoring, disk storage breakdown, Windows Notifications Hub, and **Google Gemini Pro AI Copilot** dashboard powered by **FastAPI**, **psutil**, **google-genai**, **WebSocket**, and a sleek **Dark Theme Sidebar UI** (Chart.js, HTML5/CSS3/Vanilla JS).

---

## 🌟 Key Features & Layout Architecture

### 🧭 Fixed Left Sidebar Navigation (250px)
- 📌 **Branded Sidebar Header**: Glowing system activity pulse icon & hostname subtitle.
- 🗂️ **Navigation Menu Tabs**:
  1. **📊 Real-time Monitor**: Full PC telemetry (CPU, RAM, Disk, Network, Cores, Top Processes, 60s Bezier Chart, Gemini Pro AI Copilot).
  2. **💾 Disk Breakdown**: Partition folder size breakdown with interactive Donut and Bar charts.
  3. **🔔 Notifications & Events**: Full-page dedicated notifications and event logging hub with live unread counter badge.
- 🎛️ **Sidebar Mini Widgets**:
  - 🌐 **Network & Latency Widget**: Real-time ping to `8.8.8.8` (ms), Local IP (`192.168.x.x`), and pulsating Online/Offline indicator.
  - ⚡ **Quick Actions Panel**: One-click **Flush DNS** (`ipconfig /flushdns`) & **Clean Temp** (cleans accessible files in `%TEMP%`) with floating toast feedback.
- 🖥️ **Sidebar System Footer**: Host machine metadata, OS version/architecture, and live uptime timer.

---

### 📊 Tab 1: Real-time Monitor & Gemini Pro AI Copilot
- ⚡ **1-Second WebSocket Streaming**: Continuous real-time updates with automatic reconnect and zero UI lag.
- 🎯 **4 Quick Overview Hero Cards (Row 1)**:
  - **CPU**: Total % utilization, Clock frequency (GHz/MHz), Cores count, load status.
  - **RAM Memory**: Used %, Used GB / Total GB, Available/Free memory.
  - **Disk Storage**: Overall storage capacity, used %, detected drive partitions count.
  - **Network (I/O)**: Live Download ↓ and Upload ↑ speeds (KB/s - MB/s), session total data transfer (MB/GB).
- 📈 **Real-time 60-Second Line Chart (Row 2 - Col 1 & 2)**: Smooth Bezier curve visualization for CPU & RAM usage history.
- 💾 **Storage Drives Breakdown (Row 2 - Col 3)**: Visual partition capacity meters with color-coded warning thresholds.
- ✨ **Google Gemini Pro AI Copilot (`NEW`) (Row 2 - Col 4)**:
  - **Gemini Pro Models Supported**: `gemini-2.5-pro` (Default - Deep reasoning), `gemini-2.5-flash` (Ultra-fast), `gemini-3.1-pro-preview`.
  - **Live Hardware Context**: Gemini Pro analyzes real-time CPU per-core load, RAM consumption, disk space, network speeds, and active processes with PIDs.
  - **Interactive Diagnostics & Q&A**: Ask any hardware questions (*"Which process consumes most RAM?"*, *"Is my CPU overheating or spiking?"*, *"How to optimize disk space?"*) and receive rich Markdown answers directly from Gemini Pro.
  - **In-App API Key Manager (⚙️)**: Enter/change your Gemini API key directly from the dashboard UI with live connection verification, or set `GEMINI_API_KEY` in `.env`.
  - **Hybrid Fallback**: Automatically falls back to the fast local engine if no API key is configured.
- 🧩 **CPU Multi-Core Matrix (Row 3)**: Live load gauge breakdown across all logical cores.
- 📋 **Top Active Processes Table (Row 4)**:
  - Switch between **Top CPU** and **Top RAM** consumers.
  - Instant search filtering by process name or PID.

---

## 🔑 How to Connect Google Gemini Pro

You have 2 convenient ways to connect your Gemini Pro API key:

### Method 1: Directly on the Dashboard UI (Recommended)
1. Open the dashboard at **[http://127.0.0.1:8000](http://127.0.0.1:8000)**.
2. On the **Gemini Pro AI** card header (top right of Row 2), click the **⚙️ Settings** icon.
3. Enter your Gemini API key (get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey)).
4. Select your preferred model (`gemini-2.5-pro` or `gemini-2.5-flash`).
5. Click **Connect & Save**!

### Method 2: Via `.env` File
Create or edit `.env` in the project root:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-pro
```

---

## 📦 Quick Start

### 1. Install Dependencies:
```bash
py -m pip install -r requirements.txt
```

### 2. Launch Dashboard:
```bash
py main.py
```

### 3. Open in Browser:
Visit: **[http://127.0.0.1:8000](http://127.0.0.1:8000)**
