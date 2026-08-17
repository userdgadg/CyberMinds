<div align="center">

<img src="./Images/circle.jpg" width="72" height="72" alt="CyberMinds logo" />

# CyberMinds

Cybersecurity you actually practice, not just read about. Short courses, a real Linux terminal in your browser, CTF challenges, and an AI helper on standby.

</div>

## What It Does

CyberMinds pairs short lessons and quizzes with a real Linux terminal, so you're running commands instead of just reading about them. Eight guided CTF challenges give you something concrete to apply what you've learned to, and an AI chatbot is available the entire time if you get stuck.

## Features

- 12 self-paced courses: security fundamentals, cryptography, Linux, networking, penetration testing, cloud security
- A real Linux terminal in the browser, isolated Docker container per session
- 8 guided CTF challenges
- AI chatbot for help, anytime
- Local progress tracking, privacy-first analytics, no personal data collected

## How It Works

<p align="center">
  <img src="./Images/readme/learning-path.svg" width="88%" alt="Learning path: Learn short courses and quizzes, Practice in a real terminal, Compete in guided CTF challenges, Get Help from the AI chatbot anytime" />
</p>

Pick a course, read the lesson, take the quiz, then practice in the terminal and try a CTF challenge. Ask the chatbot anytime.

## CTF Challenges

<p align="center">
  <img src="./Images/readme/screenshot.png" width="88%" alt="CyberMinds product screenshot" />
</p>

- **Linux Basics Warmup** — get comfortable moving around a real shell
- **Web Recon Starter** — find what a website is quietly exposing
- **Log Hunt** — dig the evidence of an attack out of raw logs
- **Privilege Escalation Trace** — follow how a low-priv user became root
- **Incident Timeline Reconstruction** — piece together what happened, and when
- **Suspicious Beaconing** — spot malware phoning home in network traffic
- **Phishing Header Analysis** — identify sender spoofing from synthetic email headers
- **IAM Least Privilege** — repair an over-permissive synthetic cloud policy

## Getting Started

```bash
git clone https://github.com/Cyber-Minds/CyberMinds.git
cd CyberMinds
npm ci
make dev
```

`make dev` starts the terminal backend in Docker and serves the site at `http://localhost:8080`.

Run the static HTML quality checks locally with:

```bash
npm run qa:static
```

## Tech Stack

HTML, CSS, and JavaScript on the frontend. A Go backend runs the terminal API, deployable to Azure or Oracle Cloud with the included Terraform configs. Hosted on GitHub Pages. Playwright and Go's test tooling cover CI.

## Architecture

<p align="center">
  <img src="./Images/readme/architecture.svg" width="88%" alt="Architecture: frontend course viewer, quiz and game, and CTF terminal; backend AI chatbox and flag verifier" />
</p>

The frontend serves the course viewer, quiz and game, and CTF terminal. The backend runs the AI chatbox and the flag verifier that grades CTF submissions.

<p align="center">
  <img src="./Images/readme/terminal-flow.svg" width="88%" alt="Terminal session flow: browser terminal connects over WebSocket to the Go backend, which spawns an isolated Docker container per session and streams stdin and stdout" />
</p>

Each terminal session opens a WebSocket to the Go backend, which spins up a dedicated Docker container and streams stdin and stdout back to the browser.

---

MIT licensed, see [`LICENSE`](LICENSE).
