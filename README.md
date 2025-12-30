# Trake

Trake is a modern Snake-inspired browser game built with vanilla JavaScript, HTML, and CSS.  
The project focuses on responsive gameplay, visual clarity, sound feedback, and extensible game systems.

The game features a polished singleplayer experience and an experimental multiplayer mode.

---

## 🎮 Features

### Singleplayer
- Classic Snake gameplay on a grid-based board
- Multiple power-ups with distinct mechanics:
  - **Speed Boost** – temporary speed increase
  - **Slowdown** – slows movement
  - **Ghost** – pass through yourself temporarily
  - **Shrink** – reduces snake length
  - **Bonus** – instant score reward
  - **Mirror Trap** – inverted controls
  - **Hazards** – lethal obstacles
- Dynamic spawning and timed effects
- Global leaderboard with arcade-style 3-letter initials
- Sound effects and background music
- Visual feedback for special states (e.g. ghost effect)

### Multiplayer (Experimental)
- Real-time multiplayer using WebSockets
- Shared game state and player lobbies
- Currently functional but not fully stable

---

## 🔊 Audio
- Background music with persistent on/off setting
- Sound effects for:
  - Movement
  - Eating food / power-ups
  - Speed boost
  - Crashes (death)
- Sound effects are independent from music mute

- Audio made by <a href="https://github.com/bjorneboman/">Björn Bohman<a>

---

## 🏆 Leaderboard
- Global leaderboard powered by **Supabase**
- Top 10 scores shared across players
- Arcade-style initial entry (exactly 3 characters)
- Local fallback if backend is unavailable

---

## 🧪 Tech Stack
- Vanilla JavaScript (ES modules)
- HTML5 Canvas
- CSS (Grid & Flexbox)
- Supabase (PostgreSQL + REST API)
- Web Audio API
- WebSockets (multiplayer)

---

## 🚧 Known Limitations
- Multiplayer mode is experimental and may behave inconsistently
- No anti-cheat or score validation (by design for this project)
- Mobile support is none existent

---

## 📝 Project Notes
This project was developed as part of a school assignment with a fixed deadline.  
Due to time constraints, further multiplayer iteration was deprioritized in favor of polishing core gameplay, audio feedback, and overall user experience.

---

## ▶️ How to Run
Simply open `index.html` in a modern browser.  
No build step required.

---

## 📜 License
This project is for educational purposes.

